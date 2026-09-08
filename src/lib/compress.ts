import { inflateSync } from "node:zlib";
import sharp, { type Sharp } from "sharp";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

/**
 * Students submit phone photos and screenshots at full camera resolution, so a
 * class packet runs to hundreds of megabytes of image data — too large for
 * Drive to preview, and large enough to exhaust the instance that builds it.
 *
 * This re-encodes embedded images at a sane page resolution. Anything it does
 * not fully understand is left exactly as it was: a slightly larger document
 * is a far better outcome than a corrupted one.
 */
export type CompressOptions = {
  /** Longest edge, in pixels. 1240 is ~150 DPI across an A4 page. */
  maxWidth: number;
  maxHeight: number;
  /** JPEG quality for re-encoded images. */
  quality: number;
};

// libvips keeps decoded images in a cache and spawns a worker per core. On a
// small instance both are pure overhead: the cache holds bitmaps that will
// never be asked for again, and parallel workers multiply peak memory by the
// core count. One image at a time, cached nowhere, is what fits.
sharp.cache(false);
sharp.concurrency(1);

export const DEFAULT_COMPRESS: CompressOptions = {
  maxWidth: 1240,
  maxHeight: 1754,
  quality: 72,
};

export type CompressResult = {
  /** Images examined. */
  seen: number;
  /** Images actually replaced with a smaller version. */
  changed: number;
  /** Images left alone, by reason. */
  skipped: Record<string, number>;
  bytesBefore: number;
  bytesAfter: number;
};

function nameOf(obj: unknown): string {
  return obj === undefined || obj === null ? "" : String(obj);
}

/** Filters can be a single name or an array of them. */
function filterList(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map(nameOf);
  return [nameOf(f)];
}

function numberAt(dict: PDFDict, key: string): number | null {
  const v = dict.get(PDFName.of(key));
  if (v instanceof PDFNumber) return v.asNumber();
  const n = Number(nameOf(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * How many samples per pixel the colour space uses. Only the spaces that map
 * cleanly onto a raw buffer are supported; anything else returns null so the
 * image is skipped rather than guessed at.
 */
function channelsFor(doc: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const raw = dict.get(PDFName.of("ColorSpace"));
  const resolved = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  const name = nameOf(resolved);

  if (name === "/DeviceGray" || name === "/CalGray" || name === "/G") return 1;
  if (name === "/DeviceRGB" || name === "/CalRGB" || name === "/RGB") return 3;

  // [/ICCBased <stream>] — the stream's /N gives the component count.
  if (resolved instanceof PDFArray && nameOf(resolved.get(0)) === "/ICCBased") {
    const streamRef = resolved.get(1);
    const stream = streamRef instanceof PDFRef ? doc.context.lookup(streamRef) : streamRef;
    if (stream instanceof PDFRawStream) {
      const n = numberAt(stream.dict, "N");
      if (n === 1) return 1;
      if (n === 3) return 3;
    }
  }
  return null;
}

/**
 * Undo a PNG predictor, which Flate-encoded images commonly use. Rows arrive
 * prefixed with a filter byte; each is reversed against the row above.
 */
function undoPngPredictor(data: Buffer, colors: number, columns: number): Buffer {
  const bpp = colors; // 8 bits per component only; callers enforce that.
  const rowLen = columns * bpp;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = Buffer.alloc(rows * rowLen);

  let prev = Buffer.alloc(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = Buffer.alloc(rowLen);

    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0; // left
      const b = prev[i]; // up
      const c = i >= bpp ? prev[i - bpp] : 0; // upper left
      const x = src[i];
      let v: number;
      switch (type) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = x; // Unknown predictor: pass through untouched.
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, r * rowLen);
    prev = cur;
  }
  return out;
}

/**
 * Re-encodes the images of an already-loaded document in place. Working on the
 * loaded document (rather than re-serialising) keeps peak memory to one image
 * at a time, which matters on the small instance that runs the merge.
 */
export async function compressDocumentImages(
  doc: PDFDocument,
  opts: CompressOptions = DEFAULT_COMPRESS
): Promise<CompressResult> {
  const result: CompressResult = {
    seen: 0,
    changed: 0,
    skipped: {},
    bytesBefore: 0,
    bytesAfter: 0,
  };
  const skip = (reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (nameOf(dict.get(PDFName.of("Subtype"))) !== "/Image") continue;

    result.seen += 1;
    const original = obj.contents;
    result.bytesBefore += original.length;
    result.bytesAfter += original.length; // Adjusted below only if replaced.

    // Transparency would be lost by a JPEG round trip, so leave these be.
    if (dict.has(PDFName.of("SMask")) || dict.has(PDFName.of("Mask"))) {
      skip("has transparency");
      continue;
    }

    const width = numberAt(dict, "Width");
    const height = numberAt(dict, "Height");
    if (!width || !height) {
      skip("no dimensions");
      continue;
    }

    const filters = filterList(dict);
    const isJpeg = filters.includes("/DCTDecode");
    const isFlate = filters.includes("/FlateDecode");

    let input: Sharp;
    if (isJpeg && filters.length === 1) {
      input = sharp(Buffer.from(original));
    } else if (isFlate && filters.length === 1) {
      const bpc = numberAt(dict, "BitsPerComponent");
      if (bpc !== 8) {
        skip(`bits per component ${bpc}`);
        continue;
      }
      const channels = channelsFor(doc, dict);
      if (!channels) {
        skip("unsupported colour space");
        continue;
      }

      let raw: Buffer;
      try {
        raw = inflateSync(Buffer.from(original));
      } catch {
        skip("inflate failed");
        continue;
      }

      // Predictors are declared in DecodeParms and must be undone first.
      const parmsRaw = dict.get(PDFName.of("DecodeParms"));
      const parms = parmsRaw instanceof PDFRef ? doc.context.lookup(parmsRaw) : parmsRaw;
      if (parms instanceof PDFDict) {
        const predictor = numberAt(parms, "Predictor") ?? 1;
        if (predictor >= 10) {
          const columns = numberAt(parms, "Columns") ?? width;
          const colors = numberAt(parms, "Colors") ?? channels;
          raw = undoPngPredictor(raw, colors, columns);
        } else if (predictor !== 1) {
          skip(`predictor ${predictor}`);
          continue;
        }
      }

      if (raw.length < width * height * channels) {
        skip("short pixel buffer");
        continue;
      }
      input = sharp(raw.subarray(0, width * height * channels), {
        raw: { width, height, channels },
      });
    } else {
      skip(filters.join("+") || "no filter");
      continue;
    }

    let encoded: Buffer;
    try {
      encoded = await input
        .resize({
          width: opts.maxWidth,
          height: opts.maxHeight,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toBuffer();
    } catch {
      skip("re-encode failed");
      continue;
    }

    // Never make a file bigger: a small or already-efficient image loses here.
    if (encoded.length >= original.length) {
      skip("no saving");
      continue;
    }

    const meta = await sharp(encoded).metadata();
    const newDict = doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: meta.width ?? width,
      Height: meta.height ?? height,
      ColorSpace: meta.channels === 1 ? "DeviceGray" : "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    });
    doc.context.assign(ref, PDFRawStream.of(newDict, encoded));

    result.changed += 1;
    result.bytesAfter += encoded.length - original.length;
  }

  return result;
}

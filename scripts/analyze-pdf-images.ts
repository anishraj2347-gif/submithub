/**
 * Breaks a PDF down by embedded image, so a heavy document can be attributed
 * to real causes rather than guessed at. Reports each image XObject's filter,
 * pixel dimensions and stored size, and totals them by filter.
 *
 *   npx tsx scripts/analyze-pdf-images.ts <file.pdf>
 */
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray } from "pdf-lib";

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

function filterNames(dict: PDFDict): string {
  const f = dict.get(PDFName.of("Filter"));
  if (!f) return "(none)";
  if (f instanceof PDFArray) {
    return f.asArray().map((x) => String(x)).join("+");
  }
  return String(f);
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: analyze-pdf-images.ts <file.pdf>");

  const bytes = readFileSync(path);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  console.log(`file: ${path}`);
  console.log(`size: ${mb(bytes.length)} MB, ${doc.getPageCount()} pages\n`);

  type Img = { ref: string; filter: string; w: number; h: number; bytes: number };
  const seen = new Map<string, Img>();

  // Walk every indirect object rather than page resources: a shared image is
  // then counted once, which is what actually occupies the file.
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (String(subtype) !== "/Image") continue;

    const w = Number(dict.get(PDFName.of("Width"))?.toString() ?? 0);
    const h = Number(dict.get(PDFName.of("Height"))?.toString() ?? 0);
    seen.set(ref.toString(), {
      ref: ref.toString(),
      filter: filterNames(dict),
      w,
      h,
      bytes: obj.contents.length,
    });
  }

  const imgs = [...seen.values()].sort((a, b) => b.bytes - a.bytes);
  const imageTotal = imgs.reduce((n, i) => n + i.bytes, 0);

  console.log(`${imgs.length} image objects, ${mb(imageTotal)} MB total`);
  console.log(`that is ${((imageTotal / bytes.length) * 100).toFixed(1)}% of the file\n`);

  const byFilter = new Map<string, { count: number; bytes: number }>();
  for (const i of imgs) {
    const e = byFilter.get(i.filter) ?? { count: 0, bytes: 0 };
    e.count += 1;
    e.bytes += i.bytes;
    byFilter.set(i.filter, e);
  }
  console.log("by filter:");
  for (const [f, e] of [...byFilter].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${f.padEnd(22)} ${String(e.count).padStart(4)} images  ${mb(e.bytes).padStart(7)} MB`);
  }

  console.log("\nlargest 15:");
  console.log("     MB   pixels          eff. DPI on A4   filter");
  for (const i of imgs.slice(0, 15)) {
    // A4 is 8.27in wide, so an image spanning the page has this DPI.
    const dpi = i.w ? Math.round(i.w / 8.27) : 0;
    console.log(
      `  ${mb(i.bytes).padStart(5)}   ${`${i.w}x${i.h}`.padEnd(14)}  ${String(dpi).padStart(9)}      ${i.filter}`
    );
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

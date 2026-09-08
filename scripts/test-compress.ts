/**
 * Runs the image compression pass over a real PDF and reports what it did.
 * Asserts the result is still a valid document with every page intact — a
 * smaller file that lost a page would be worse than no compression at all.
 *
 *   npx tsx scripts/test-compress.ts <in.pdf> [out.pdf]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { compressDocumentImages, DEFAULT_COMPRESS } from "../src/lib/compress";

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`  ok  ${msg}`);
  }
}

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath) throw new Error("usage: test-compress.ts <in.pdf> [out.pdf]");

  const before = readFileSync(inPath);
  const doc = await PDFDocument.load(before, { ignoreEncryption: true });
  const pagesBefore = doc.getPageCount();
  console.log(`in:  ${mb(before.length)} MB, ${pagesBefore} pages`);
  console.log(`settings: max ${DEFAULT_COMPRESS.maxWidth}x${DEFAULT_COMPRESS.maxHeight}, q${DEFAULT_COMPRESS.quality}\n`);

  const started = Date.now();
  const res = await compressDocumentImages(doc);
  const took = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`images seen:      ${res.seen}`);
  console.log(`images rewritten: ${res.changed}`);
  console.log(`image bytes:      ${mb(res.bytesBefore)} MB -> ${mb(res.bytesAfter)} MB`);
  if (Object.keys(res.skipped).length) {
    console.log("skipped:");
    for (const [why, n] of Object.entries(res.skipped)) console.log(`   ${n.toString().padStart(4)}  ${why}`);
  }

  const after = Buffer.from(await doc.save());
  console.log(`\nfile: ${mb(before.length)} MB -> ${mb(after.length)} MB  (${took}s)`);
  console.log(`reduction: ${(100 - (after.length / before.length) * 100).toFixed(1)}%`);

  if (outPath) {
    writeFileSync(outPath, after);
    console.log(`wrote ${outPath}`);
  }

  // The compressed file must still be a real, complete PDF.
  const reloaded = await PDFDocument.load(after, { ignoreEncryption: true });
  console.log("");
  assert(reloaded.getPageCount() === pagesBefore, `page count preserved (${pagesBefore})`);
  assert(after.length < before.length, "file got smaller");
  assert(after.subarray(0, 5).toString("latin1") === "%PDF-", "output has a PDF header");
  assert(after.subarray(-6).toString("latin1").includes("%%EOF"), "output ends with %%EOF");
  assert(res.changed > 0, "at least one image was rewritten");

  const first = reloaded.getPage(0);
  assert(Math.round(first.getWidth()) === 595, "page geometry unchanged (A4 width)");

  // The point of the exercise: comfortably previewable and no longer a memory
  // hazard on a small instance.
  assert(after.length < 50 * 1024 * 1024, `under 50 MB (${mb(after.length)} MB)`);
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

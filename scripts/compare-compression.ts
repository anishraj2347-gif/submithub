/**
 * Compares compression settings on a real document, so the trade-off between
 * size and legibility is a measurement rather than a guess.
 *
 *   npx tsx scripts/compare-compression.ts <in.pdf> [outDir]
 */
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { compressDocumentImages, type CompressOptions } from "../src/lib/compress";

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

type Variant = { label: string; opts: CompressOptions & { grayscale?: boolean } };

const VARIANTS: Variant[] = [
  { label: "current (150dpi colour q72)", opts: { maxWidth: 1240, maxHeight: 1754, quality: 72 } },
  { label: "150dpi colour q55", opts: { maxWidth: 1240, maxHeight: 1754, quality: 55 } },
  { label: "150dpi GREY q72", opts: { maxWidth: 1240, maxHeight: 1754, quality: 72, grayscale: true } },
  { label: "120dpi GREY q65", opts: { maxWidth: 992, maxHeight: 1403, quality: 65, grayscale: true } },
  { label: "100dpi GREY q60", opts: { maxWidth: 827, maxHeight: 1169, quality: 60, grayscale: true } },
];

async function main() {
  const [inPath, outDir] = process.argv.slice(2);
  const source = await readFile(inPath);
  console.log(`source: ${mb(source.length)} MB\n`);
  console.log("  size    vs source   setting");

  for (const v of VARIANTS) {
    // Reload each time: compression is destructive, so every variant must
    // start from the same original bytes.
    const doc = await PDFDocument.load(source, { ignoreEncryption: true });
    await compressDocumentImages(doc, v.opts);
    const out = Buffer.from(await doc.save());
    const pct = (100 - (out.length / source.length) * 100).toFixed(0);
    console.log(`  ${mb(out.length).padStart(5)} MB   -${pct.padStart(2)}%      ${v.label}`);
    if (outDir) {
      writeFileSync(join(outDir, `variant-${v.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`), out);
    }
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

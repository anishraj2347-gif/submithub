import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const OUT = process.argv[2];
async function main() {
  const src = await PDFDocument.load(
    fs.readFileSync("/Users/anishraj/Downloads/Final_dbms-assignment-3_2026-09-07_v1.pdf")
  );
  for (const p of [0, 1, 2, 3, 4, 8]) {
    const d = await PDFDocument.create();
    const [pg] = await d.copyPages(src, [p]);
    d.addPage(pg);
    fs.writeFileSync(`${OUT}/p${p + 1}.pdf`, await d.save());
  }
  console.log("split pages 1,2,3,4,5,9");
}
main();

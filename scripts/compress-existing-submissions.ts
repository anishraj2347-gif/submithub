/**
 * Backfill: shrinks the images in submissions that were stored before uploads
 * were compressed. New submissions are compressed on arrival, so this only
 * needs running once per assignment that predates that.
 *
 * Files are handled one at a time and replaced in place on Drive, so the same
 * file id keeps working and nothing downstream needs updating.
 *
 * Dry run by default; pass --apply to write.
 *
 *   DATABASE_URL="..." npx tsx scripts/compress-existing-submissions.ts
 *   DATABASE_URL="..." npx tsx scripts/compress-existing-submissions.ts --apply
 */
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDrive, downloadFile } from "../src/lib/drive";
import { compressDocumentImages } from "../src/lib/compress";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

async function main() {
  const apply = process.argv.includes("--apply");
  const assignment = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

  const subs = await prisma.submission.findMany({
    where: { assignmentId: assignment.id, status: { in: ["CONVERTED", "UPLOADED"] } },
    include: { student: true },
    orderBy: { student: { sortKey: "asc" } },
  });

  const drive = await getDrive();
  let before = 0;
  let after = 0;
  let rewritten = 0;

  console.log(`${assignment.title}: ${subs.length} submissions${apply ? "" : "  (dry run)"}\n`);

  for (const sub of subs) {
    const who = `${sub.student.enrollmentNo} ${sub.student.name}`;
    if (!sub.pdfDriveFileId) {
      console.log(`  ${who}: no converted PDF, skipped`);
      continue;
    }

    const original = await downloadFile(drive, sub.pdfDriveFileId);
    const doc = await PDFDocument.load(original, { ignoreEncryption: true });
    const res = await compressDocumentImages(doc);

    if (res.changed === 0) {
      before += original.length;
      after += original.length;
      console.log(`  ${who}: ${mb(original.length)} MB — nothing to compress`);
      continue;
    }

    const shrunk = Buffer.from(await doc.save());
    before += original.length;

    // Never replace a file with a larger one.
    if (shrunk.length >= original.length) {
      after += original.length;
      console.log(`  ${who}: ${mb(original.length)} MB — no saving, left alone`);
      continue;
    }
    after += shrunk.length;

    const pct = (100 - (shrunk.length / original.length) * 100).toFixed(0);
    console.log(
      `  ${who}: ${mb(original.length)} -> ${mb(shrunk.length)} MB  (-${pct}%, ${res.changed} images)`
    );

    if (apply) {
      // Update the existing Drive file so its id — which the submission row
      // and every merge already reference — stays valid.
      await drive.files.update({
        fileId: sub.pdfDriveFileId,
        media: { mimeType: "application/pdf", body: Readable.from(shrunk) },
        fields: "id",
      });
      rewritten += 1;
    }
  }

  console.log(`\ntotal: ${mb(before)} MB -> ${mb(after)} MB`);
  if (before > 0) {
    console.log(`reduction: ${(100 - (after / before) * 100).toFixed(1)}%`);
  }
  console.log(apply ? `rewrote ${rewritten} file(s) on Drive` : "dry run — re-run with --apply");
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

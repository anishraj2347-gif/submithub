/**
 * Creates real submissions for a few extra students by pushing genuine files
 * through the same Drive helpers the upload route uses. Used to exercise the
 * merge end to end without signing in as 32 different people.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDrive, ensureAssignmentTree, uploadOrReplace } from "../src/lib/drive";
import { buildStoredFilename } from "../src/lib/utils";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function makePdf(label: string, pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(label, { x: 60, y: 740, size: 22, font });
    p.drawText(`Page ${i + 1} of ${pages}`, { x: 60, y: 700, size: 12, font: body });
  }
  return Buffer.from(await doc.save());
}

async function main() {
  const assignment = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  const drive = await getDrive();
  const tree = await ensureAssignmentTree(drive, assignment.course, assignment.title);

  // Deliberately spans the 9 -> 10 boundary to prove natural ordering in the real merge.
  const targets = ["21BCE2", "21BCE9", "21BCE10", "21BCE11"];
  const pageCounts = [1, 3, 2, 1];

  for (const [i, enrollmentNo] of targets.entries()) {
    const student = await prisma.student.findUniqueOrThrow({ where: { enrollmentNo } });
    const pages = pageCounts[i];
    const bytes = await makePdf(`${student.enrollmentNo} — ${student.name}`, pages);
    const name = buildStoredFilename(student.enrollmentNo, student.name, assignment.slug, "pdf");

    const original = await uploadOrReplace(drive, {
      name, parentId: tree.submissions, mimeType: "application/pdf", body: bytes,
    });
    const normalized = await uploadOrReplace(drive, {
      name, parentId: tree.normalized, mimeType: "application/pdf", body: bytes,
    });

    await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      update: {
        storedFilename: name, driveFileId: original.id, driveWebViewLink: original.webViewLink,
        pdfDriveFileId: normalized.id, pageCount: pages, status: "CONVERTED",
      },
      create: {
        assignmentId: assignment.id, studentId: student.id,
        originalFilename: `${student.name}.pdf`, storedFilename: name,
        driveFileId: original.id, driveWebViewLink: original.webViewLink,
        pdfDriveFileId: normalized.id, mimeType: "application/pdf",
        sizeBytes: bytes.length, pageCount: pages, status: "CONVERTED",
      },
    });
    console.log(`  uploaded ${name} (${pages}p)`);
  }
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

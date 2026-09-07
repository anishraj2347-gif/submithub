/**
 * End-to-end exercise of the real merge engine with an in-memory storage seam.
 * Creates throwaway submissions for the seeded roster, merges them, and asserts
 * the page map, ordering and total page count are correct.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { runMergeJob, type MergeStorage } from "../src/lib/merge";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const files = new Map<string, Buffer>();
let saved: { name: string; bytes: Buffer } | null = null;

const storage: MergeStorage = {
  async fetchPdf(id) {
    const b = files.get(id);
    if (!b) throw new Error(`missing ${id}`);
    return b;
  },
  async saveFinal(name, bytes) {
    saved = { name, bytes };
    return { id: "fake-final", webViewLink: "https://drive.example/fake" };
  },
};

async function makePdf(label: string, pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`${label} — page ${i + 1}`, { x: 60, y: 700, size: 18, font });
  }
  return Buffer.from(await doc.save());
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`  ok  ${msg}`);
  }
}

async function main() {
  const assignment = await prisma.assignment.findFirstOrThrow();
  const students = await prisma.student.findMany({ orderBy: { sortKey: "asc" }, take: 12 });

  // 12 students, deliberately spanning the 21BCE9 -> 21BCE10 boundary.
  const pageCounts = [3, 1, 2, 4, 1, 2, 5, 1, 2, 3, 1, 2];
  const subs = [];

  for (const [i, student] of students.entries()) {
    const bytes = await makePdf(student.enrollmentNo, pageCounts[i]);
    const fileId = `mem-${student.enrollmentNo}`;
    files.set(fileId, bytes);

    const sub = await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      update: { pdfDriveFileId: fileId, pageCount: pageCounts[i], status: "CONVERTED" },
      create: {
        assignmentId: assignment.id,
        studentId: student.id,
        originalFilename: `${student.name}.pdf`,
        storedFilename: `${student.enrollmentNo}_test.pdf`,
        pdfDriveFileId: fileId,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        pageCount: pageCounts[i],
        status: "CONVERTED",
      },
    });
    subs.push(sub);
  }

  const options = { coverPage: true, separators: true, pageNumbers: true, tableOfContents: true };
  const job = await prisma.mergeJob.create({
    data: {
      assignmentId: assignment.id,
      includedSubmissions: subs.map((s) => s.id),
      version: 999,
      pageMap: { options },
    },
  });

  await runMergeJob(job.id, storage);

  const done = await prisma.mergeJob.findUniqueOrThrow({ where: { id: job.id } });
  console.log(`\nJob status: ${done.status}${done.error ? ` — ${done.error}` : ""}`);
  assert(done.status === "SUCCESS", "merge job succeeded");
  assert(saved !== null, "final PDF was handed to storage");

  const submittedPages = pageCounts.reduce((a, b) => a + b, 0);
  const expected = submittedPages + 1 /* cover */ + 1 /* toc */ + students.length /* separators */;
  assert(done.totalPages === expected, `total pages ${done.totalPages} === expected ${expected}`);

  const parsed = await PDFDocument.load(saved!.bytes);
  assert(parsed.getPageCount() === expected, "output PDF opens and page count matches");

  const entries = (done.pageMap as { entries: { enrollmentNo: string; startPage: number; endPage: number }[] })
    .entries;
  assert(entries.length === students.length, "page map has one entry per student");

  const order = entries.map((e) => e.enrollmentNo);
  const expectedOrder = students.map((s) => s.enrollmentNo);
  assert(
    JSON.stringify(order) === JSON.stringify(expectedOrder),
    `merge order is enrollment-ascending (${order.slice(7, 11).join(", ")})`
  );

  for (const [i, e] of entries.entries()) {
    const span = e.endPage - e.startPage + 1;
    if (span !== pageCounts[i]) {
      assert(false, `page span for ${e.enrollmentNo} is ${span}, expected ${pageCounts[i]}`);
    }
  }
  assert(true, "every student's page span matches their submitted page count");

  // Cleanup: remove the throwaway job and submissions.
  await prisma.mergeJob.delete({ where: { id: job.id } });
  await prisma.submission.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
  await prisma.assignment.update({ where: { id: assignment.id }, data: { status: "OPEN" } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

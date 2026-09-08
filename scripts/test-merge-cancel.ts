/**
 * Exercises the stop path: a merge that is cancelled mid-run must unwind
 * without uploading anything, must land on CANCELLED rather than FAILED, and
 * must not mark the assignment MERGED.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { runMergeJob, type MergeStorage } from "../src/lib/merge";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const files = new Map<string, Buffer>();
let saveCalls = 0;
let fetched = 0;
let jobId = "";

// Stands in for the CR pressing "Stop" while the third file is downloading.
const storage: MergeStorage = {
  async fetchPdf(id) {
    fetched += 1;
    if (fetched === 3) {
      await prisma.mergeJob.update({ where: { id: jobId }, data: { status: "CANCELLED" } });
    }
    const b = files.get(id);
    if (!b) throw new Error(`missing ${id}`);
    return b;
  },
  async saveFinal(name, bytes) {
    saveCalls += 1;
    return { id: "fake-final", webViewLink: null };
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
  const before = assignment.status;
  const students = await prisma.student.findMany({ orderBy: { sortKey: "asc" }, take: 8 });
  const subs = [];

  for (const student of students) {
    const bytes = await makePdf(student.enrollmentNo, 2);
    const fileId = `cancel-${student.enrollmentNo}`;
    files.set(fileId, bytes);
    const sub = await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      update: { pdfDriveFileId: fileId, pageCount: 2, status: "CONVERTED" },
      create: {
        assignmentId: assignment.id,
        studentId: student.id,
        originalFilename: `${student.name}.pdf`,
        storedFilename: `${student.enrollmentNo}_cancel.pdf`,
        pdfDriveFileId: fileId,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        pageCount: 2,
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
      version: 998,
      pageMap: { options },
    },
  });
  jobId = job.id;

  // A cancel must unwind quietly, not surface as a thrown error to the caller.
  await runMergeJob(job.id, storage);

  const done = await prisma.mergeJob.findUniqueOrThrow({ where: { id: job.id } });
  console.log(`\nJob status: ${done.status} / step ${done.step}`);

  assert(done.status === "CANCELLED", "cancelled job lands on CANCELLED, not FAILED");
  assert(done.step === "CANCELLED", "step reads CANCELLED");
  assert(done.error === null, "no error message is recorded for a deliberate stop");
  assert(done.finishedAt !== null, "the run is closed out with a finishedAt");
  assert(saveCalls === 0, "nothing was uploaded to storage");
  assert(done.outputDriveFileId === null, "no output file is recorded");
  assert(fetched < students.length, `stopped early — fetched ${fetched} of ${students.length}`);

  const after = await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert(after.status === before, `assignment status untouched (${after.status})`);

  // Deleting the record must leave the job gone but the submissions intact.
  await prisma.mergeJob.delete({ where: { id: job.id } });
  const gone = await prisma.mergeJob.findUnique({ where: { id: job.id } });
  assert(gone === null, "the merge record deletes cleanly");
  const stillThere = await prisma.submission.count({ where: { id: { in: subs.map((s) => s.id) } } });
  assert(stillThere === subs.length, "deleting a merge leaves submissions untouched");

  await prisma.submission.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

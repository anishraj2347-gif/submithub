/** A corrupt file must fail the whole job and name the student — never a partial PDF. */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument } from "pdf-lib";
import { runMergeJob, type MergeStorage } from "../src/lib/merge";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const files = new Map<string, Buffer>();
let saveCalls = 0;

const storage: MergeStorage = {
  async fetchPdf(id) {
    const b = files.get(id);
    if (!b) throw new Error(`missing ${id}`);
    return b;
  },
  async saveFinal() {
    saveCalls++;
    return { id: "x", webViewLink: null };
  },
};

async function main() {
  const assignment = await prisma.assignment.findFirstOrThrow();
  const students = await prisma.student.findMany({ orderBy: { sortKey: "asc" }, take: 3 });

  const subs = [];
  for (const [i, student] of students.entries()) {
    let bytes: Buffer;
    if (i === 1) {
      bytes = Buffer.from("this is definitely not a pdf");
    } else {
      const d = await PDFDocument.create();
      d.addPage();
      bytes = Buffer.from(await d.save());
    }
    const fileId = `bad-${student.enrollmentNo}`;
    files.set(fileId, bytes);
    subs.push(
      await prisma.submission.upsert({
        where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
        update: { pdfDriveFileId: fileId, pageCount: 1, status: "CONVERTED" },
        create: {
          assignmentId: assignment.id, studentId: student.id,
          originalFilename: "x.pdf", storedFilename: `${student.enrollmentNo}_x.pdf`,
          pdfDriveFileId: fileId, mimeType: "application/pdf",
          sizeBytes: bytes.length, pageCount: 1, status: "CONVERTED",
        },
      })
    );
  }

  const job = await prisma.mergeJob.create({
    data: { assignmentId: assignment.id, includedSubmissions: subs.map((s) => s.id), version: 998 },
  });

  await runMergeJob(job.id, storage);
  const done = await prisma.mergeJob.findUniqueOrThrow({ where: { id: job.id } });

  const culprit = students[1].enrollmentNo;
  const ok =
    done.status === "FAILED" &&
    Boolean(done.error?.includes(culprit)) &&
    saveCalls === 0;

  console.log(`status=${done.status}`);
  console.log(`error="${done.error}"`);
  console.log(`saveFinal called ${saveCalls} times`);
  console.log(ok ? `  ok  job failed, named ${culprit}, and produced no output` : "  FAIL");
  if (!ok) process.exitCode = 1;

  await prisma.mergeJob.delete({ where: { id: job.id } });
  await prisma.submission.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
  await prisma.assignment.update({ where: { id: assignment.id }, data: { status: "OPEN" } });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

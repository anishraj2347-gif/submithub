/**
 * Runs a real merge from this machine: builds the PDF with the production
 * merge engine, uploads it to the connected Google Drive account, and records
 * the job so it appears in the website's merge history like any other.
 *
 * This is the same code path the site uses — the only difference is where the
 * process happens to be running. It exists because the merge runs in-process
 * on a free-tier host that sleeps mid-job; running it here finishes the work.
 *
 * Submission order matches the verification screen: roster sortKey ascending.
 *
 *   DATABASE_URL="..." npx tsx scripts/run-merge-now.ts          # dry run
 *   DATABASE_URL="..." npx tsx scripts/run-merge-now.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runMergeJob } from "../src/lib/merge";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const OPTIONS = { coverPage: true, separators: true, pageNumbers: true, tableOfContents: true };

async function main() {
  const apply = process.argv.includes("--apply");

  const assignment = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

  const blocking = await prisma.mergeJob.findFirst({
    where: { assignmentId: assignment.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (blocking) {
    throw new Error(`v${blocking.version} is still ${blocking.status}. Stop it before merging.`);
  }

  // Roster order, exactly as the verification screen presents it.
  const students = await prisma.student.findMany({
    where: { isRosterMember: true },
    orderBy: { sortKey: "asc" },
  });
  const subs = await prisma.submission.findMany({
    where: { assignmentId: assignment.id, status: { in: ["CONVERTED", "UPLOADED"] } },
  });
  const byStudent = new Map(subs.map((s) => [s.studentId, s]));
  const ordered = students.map((st) => byStudent.get(st.id)).filter((s) => s !== undefined);

  const noPdf = ordered.filter((s) => !s.pdfDriveFileId);
  if (noPdf.length > 0) {
    throw new Error(`${noPdf.length} submission(s) have no converted PDF; the merge would fail.`);
  }

  const version = (await prisma.mergeJob.count({ where: { assignmentId: assignment.id } })) + 1;

  console.log(`Assignment: ${assignment.title} (${assignment.slug})`);
  console.log(`Submissions to merge: ${ordered.length}`);
  console.log(`Version: v${version}`);
  console.log(`Options: ${Object.keys(OPTIONS).join(", ")}`);
  console.log(`Destination: Drive -> ${assignment.title}/final/`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to build and upload.");
    return;
  }

  const job = await prisma.mergeJob.create({
    data: {
      assignmentId: assignment.id,
      status: "QUEUED",
      version,
      includedSubmissions: ordered.map((s) => s.id),
      pageMap: { options: OPTIONS },
    },
  });
  console.log(`\nCreated job ${job.id}. Merging…`);

  // No storage argument: this uses the real Google Drive path.
  await runMergeJob(job.id);

  const done = await prisma.mergeJob.findUniqueOrThrow({ where: { id: job.id } });
  console.log(`\nStatus:    ${done.status}${done.error ? ` — ${done.error}` : ""}`);
  if (done.status !== "SUCCESS") process.exitCode = 1;
  console.log(`File:      ${done.outputFilename ?? "(none)"}`);
  console.log(`Pages:     ${done.totalPages}`);
  console.log(`Drive id:  ${done.outputDriveFileId ?? "(none)"}`);
  console.log(`Drive url: ${done.outputUrl ?? "(none)"}`);

  const after = await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
  console.log(`Assignment status: ${after.status}`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

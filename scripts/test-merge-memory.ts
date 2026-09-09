/**
 * Measures peak memory for a full, real merge — the thing that decides whether
 * the deployed instance can finish one.
 *
 * Fetches the actual submissions from Drive but keeps the finished document in
 * memory instead of uploading it, so the run is read-only apart from a
 * throwaway job row that is deleted at the end.
 *
 *   DATABASE_URL="..." npx tsx scripts/test-merge-memory.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runMergeJob, type MergeStorage } from "../src/lib/merge";
import { getDrive, downloadFile } from "../src/lib/drive";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Render's free web service.
const INSTANCE_MB = 512;

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
  const assignment = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  const students = await prisma.student.findMany({
    where: { isRosterMember: true },
    orderBy: { sortKey: "asc" },
  });
  const subs = await prisma.submission.findMany({
    where: { assignmentId: assignment.id, status: { in: ["CONVERTED", "UPLOADED"] } },
  });
  const byStudent = new Map(subs.map((s) => [s.studentId, s]));
  const ordered = students.map((s) => byStudent.get(s.id)).filter((s) => s !== undefined);

  const drive = await getDrive();
  let saved: Buffer | null = null;
  let peak = process.memoryUsage().rss;
  let peakAfterFetch = 0;
  const watch = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
    // Once reading is done, track the assemble-and-save phase separately.
    if (lastFetchAt > 0 && Date.now() - lastFetchAt > 1500 && rss > peakAfterFetch) {
      peakAfterFetch = rss;
    }
  }, 50);

  // Mark when the last source file is read: everything after that point is
  // assembling and saving, so the two phases can be told apart.
  let fetches = 0;
  let lastFetchAt = 0;
  let peakDuringFetch = 0;
  const storage: MergeStorage = {
    fetchPdf: async (id) => {
      fetches += 1;
      lastFetchAt = Date.now();
      const b = await downloadFile(drive, id);
      peakDuringFetch = Math.max(peakDuringFetch, process.memoryUsage().rss);
      return b;
    },
    async saveFinal(_name, file) {
      // Read it back so the assertions still see the finished document.
      saved = readFileSync(file.path);
      return { id: "not-uploaded", webViewLink: null };
    },
  };

  const job = await prisma.mergeJob.create({
    data: {
      assignmentId: assignment.id,
      status: "QUEUED",
      // Marked so it is obvious in the history if cleanup ever fails.
      version: 9999,
      includedSubmissions: ordered.map((s) => s.id),
      pageMap: {
        options: { coverPage: true, separators: true, pageNumbers: true, tableOfContents: true },
      },
    },
  });

  const started = Date.now();
  try {
    await runMergeJob(job.id, storage);
    const done = await prisma.mergeJob.findUniqueOrThrow({ where: { id: job.id } });
    clearInterval(watch);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const images = (done.pageMap as { images?: { bytesBefore: number; bytesAfter: number } } | null)
      ?.images;

    console.log(`merged ${ordered.length} submissions in ${secs}s`);
    console.log(`status: ${done.status}${done.error ? ` — ${done.error}` : ""}`);
    console.log(`pages: ${done.totalPages}`);
    if (images) {
      console.log(
        `images: ${mb(images.bytesBefore)} MB -> ${mb(images.bytesAfter)} MB ` +
          `(${(100 - (images.bytesAfter / images.bytesBefore) * 100).toFixed(1)}% smaller)`
      );
    }
    const out = saved as Buffer | null;
    console.log(`final document: ${out ? mb(out.length) : "?"} MB`);
    console.log(`peak RSS: ${mb(peak)} MB of a ${INSTANCE_MB} MB instance`);
    console.log(
      `  peak while reading ${fetches} submissions: ${mb(peakDuringFetch)} MB\n` +
        `  peak after the last read (assemble + save): ${mb(peakAfterFetch)} MB\n`
    );

    assert(done.status === "SUCCESS", "the merge completed");
    assert(out !== null, "a document was produced");
    assert(out!.length < 40 * 1024 * 1024, `output under 40 MB (${mb(out!.length)} MB)`);
    // The real question: does this fit on the box that has to run it? The web
    // service also carries Next.js and Prisma, so headroom here is not spare
    // capacity — it is what those need.
    const limit = INSTANCE_MB * 1024 * 1024;
    assert(peak < limit, `peak memory fits the instance (${mb(peak)} MB of ${INSTANCE_MB} MB)`);
    const headroom = limit - peak;
    console.log(
      `\nheadroom: ${mb(headroom)} MB for Next.js, Prisma and everything else.` +
        (headroom < 150 * 1024 * 1024
          ? " That is tight — a merge on the deployed instance may still be killed."
          : "")
    );
  } finally {
    clearInterval(watch);
    await prisma.mergeJob.delete({ where: { id: job.id } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

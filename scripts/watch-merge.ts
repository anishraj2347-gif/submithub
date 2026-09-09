/**
 * Follows the newest unfinished merge and prints a line whenever it changes.
 * Exits when the job reaches a terminal state, or when it stops moving for
 * long enough that its worker must be gone — because a merge that dies leaves
 * its row untouched, and silence would otherwise look like progress.
 *
 *   DATABASE_URL="..." npx tsx scripts/watch-merge.ts [jobId]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const POLL_MS = 10_000;
// A merge of this class takes about a minute; five without movement is dead.
const STALL_MS = 5 * 60 * 1000;

const now = () => new Date().toLocaleTimeString();

async function main() {
  let id = process.argv[2];
  if (!id) {
    const job = await prisma.mergeJob.findFirst({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { startedAt: "desc" },
    });
    if (!job) {
      console.log(`${now()} no merge is running`);
      return;
    }
    id = job.id;
  }

  let lastSignature = "";
  let lastChangeAt = Date.now();

  for (;;) {
    const job = await prisma.mergeJob.findUnique({ where: { id } });
    if (!job) {
      console.log(`${now()} job ${id} no longer exists (deleted)`);
      return;
    }

    const signature = `${job.status}/${job.step}/${job.progress}`;
    if (signature !== lastSignature) {
      console.log(
        `${now()} v${job.version} ${job.status} ${job.step} ${job.progress}% (${job.includedSubmissions.length} files)`
      );
      lastSignature = signature;
      lastChangeAt = Date.now();
    }

    if (job.status === "SUCCESS") {
      console.log(
        `${now()} DONE — ${job.outputFilename}, ${job.totalPages} pages. The website merge worked.`
      );
      return;
    }
    if (job.status === "FAILED") {
      console.log(`${now()} FAILED — ${job.error ?? "no message recorded"}`);
      return;
    }
    if (job.status === "CANCELLED") {
      console.log(`${now()} CANCELLED — stopped by hand`);
      return;
    }

    if (Date.now() - lastChangeAt > STALL_MS) {
      const mins = Math.round((Date.now() - lastChangeAt) / 60000);
      console.log(
        `${now()} STALLED at ${job.step} ${job.progress}% for ${mins}m — ` +
          `the worker is gone, almost certainly killed for memory. ` +
          `The dashboard will free the lock automatically 30m after it started.`
      );
      return;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main()
  .catch((e) => {
    console.log(`${now()} watch error: ${e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

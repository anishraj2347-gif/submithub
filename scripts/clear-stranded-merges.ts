/**
 * Closes out merge jobs that no worker is running any more.
 *
 * A merge runs in-process (`void runMergeJob(...)`), so if the service
 * restarts — a deploy, or Render's free tier spinning down — the worker dies
 * and its row is left at QUEUED/RUNNING for ever. That stale row then blocks
 * every future merge, because the dashboard treats any unfinished job as
 * "a merge is already running".
 *
 * Such a job is marked FAILED rather than CANCELLED: nobody stopped it, it
 * died, and the CR deserves to be told which of those happened.
 *
 * Dry run by default; pass --apply to write.
 *
 *   DATABASE_URL="..." npx tsx scripts/clear-stranded-merges.ts
 *   DATABASE_URL="..." npx tsx scripts/clear-stranded-merges.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// A merge of a whole class takes minutes, not hours. Anything older than this
// with no finishedAt has no worker behind it.
const STALE_MINUTES = 30;

const MESSAGE =
  "The server restarted while this merge was running, so it never finished. " +
  "No document was produced and no submission was changed — run the merge again.";

async function main() {
  const apply = process.argv.includes("--apply");
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000);

  const stranded = await prisma.mergeJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, startedAt: { lt: cutoff } },
    orderBy: { startedAt: "desc" },
  });

  if (stranded.length === 0) {
    console.log("No stranded merge jobs. Nothing to do.");
    return;
  }

  console.log(`${stranded.length} stranded job(s), older than ${STALE_MINUTES}m:\n`);
  for (const j of stranded) {
    const age = Math.round((Date.now() - j.startedAt.getTime()) / 60000);
    console.log(`  v${j.version}  ${j.status}/${j.step}  ${j.progress}%  age=${age}m  id=${j.id}`);
    // An uploaded file means the merge actually succeeded and only the final
    // write was lost. That needs a human decision, so leave it alone.
    if (j.outputDriveFileId) {
      console.log(`     ^ has an uploaded file (${j.outputFilename}) — SKIPPING, review by hand`);
    }
  }

  const safe = stranded.filter((j) => !j.outputDriveFileId);
  if (!apply) {
    console.log(`\nDry run. ${safe.length} would be marked FAILED. Re-run with --apply to write.`);
    return;
  }

  const res = await prisma.mergeJob.updateMany({
    where: { id: { in: safe.map((j) => j.id) }, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", step: "FAILED", error: MESSAGE, finishedAt: new Date() },
  });
  console.log(`\nMarked ${res.count} job(s) FAILED. New merges are unblocked.`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

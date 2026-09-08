/**
 * Read-only look at the merge history for whichever database DATABASE_URL
 * points at. Used to spot jobs stranded in QUEUED/RUNNING — the worker runs
 * in-process, so a deploy or restart kills it and leaves the row untouched.
 *
 *   npx tsx -r dotenv/config scripts/inspect-merge-jobs.ts \
 *     dotenv_config_path=.env.production.local
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const host = process.env.DATABASE_URL!.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`database host: ${host}\n`);

  const jobs = await prisma.mergeJob.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  console.log(`--- merge jobs (${jobs.length}) ---`);
  for (const j of jobs) {
    const age = Math.round((Date.now() - j.startedAt.getTime()) / 60000);
    console.log(
      [
        `v${j.version}`,
        j.status.padEnd(9),
        `step=${j.step}`.padEnd(18),
        `prog=${String(j.progress).padStart(3)}%`,
        `files=${j.includedSubmissions.length}`,
        `age=${age}m`,
        `finished=${j.finishedAt ? "yes" : "NO"}`,
        j.error ? `err=${j.error.slice(0, 60)}` : "",
      ].join("  ")
    );
    console.log(`      id=${j.id}`);
  }

  const a = await prisma.assignment.findFirst({ orderBy: { createdAt: "desc" } });
  console.log(
    `\n--- assignment ---\n${a?.title} | status=${a?.status} | due=${a?.dueAt?.toISOString() ?? "none"}`
  );

  if (a) {
    const subs = await prisma.submission.groupBy({
      by: ["status"],
      _count: true,
      where: { assignmentId: a.id },
    });
    console.log("--- submissions ---");
    for (const s of subs) console.log(`  ${s.status}: ${s._count}`);
  }
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

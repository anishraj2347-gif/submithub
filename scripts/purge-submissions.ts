/**
 * Removes submissions (and their Drive files) for an assignment.
 *
 *   ONLY="A45304925001,A45304925009" npx tsx -r dotenv/config scripts/purge-submissions.ts
 *   ALL=1 npx tsx -r dotenv/config scripts/purge-submissions.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDrive } from "../src/lib/drive";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = process.env.ALL === "1";
  if (!all && only.length === 0) throw new Error("Set ONLY=<enrollments> or ALL=1");

  const subs = await prisma.submission.findMany({
    where: all ? {} : { student: { enrollmentNo: { in: only } } },
    include: { student: true },
  });
  if (subs.length === 0) return console.log("Nothing to remove.");

  const drive = await getDrive();
  for (const s of subs) {
    for (const id of [s.driveFileId, s.pdfDriveFileId].filter(Boolean) as string[]) {
      await drive.files.delete({ fileId: id }).catch(() => {});
    }
    await prisma.submission.delete({ where: { id: s.id } });
    console.log(`  removed ${s.student.enrollmentNo}  ${s.storedFilename}`);
  }

  // Merge jobs reference submissions that no longer exist.
  const jobs = await prisma.mergeJob.findMany();
  for (const j of jobs) {
    if (j.outputDriveFileId) await drive.files.delete({ fileId: j.outputDriveFileId }).catch(() => {});
    await prisma.mergeJob.delete({ where: { id: j.id } });
    console.log(`  removed merge job v${j.version}`);
  }

  await prisma.assignment.updateMany({ data: { status: "OPEN" } });
  console.log(`\nDone. ${await prisma.submission.count()} submissions remain.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * Read-only preflight for running a real merge from a local machine against a
 * remote database and the connected Google Drive account.
 *
 * Checks the three things that decide whether the merge can run at all:
 * Drive is connected, no other job is holding the lock, and every submission
 * has a converted PDF behind it.
 *
 *   DATABASE_URL="..." npx tsx scripts/preflight-merge.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const cred = await prisma.driveCredential.findUnique({ where: { id: "singleton" } });
  console.log(`Drive connected:        ${cred ? "yes" : "NO — cannot upload"}`);
  if (cred) console.log(`  connected account:    ${cred.email ?? "(not recorded)"}`);
  console.log(`Local Google client id: ${process.env.GOOGLE_CLIENT_ID ? "set" : "MISSING"}`);
  console.log(`DRIVE_ROOT_FOLDER_ID:   ${process.env.DRIVE_ROOT_FOLDER_ID ?? "(unset)"}`);

  const a = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  console.log(`\nAssignment: ${a.course} — ${a.title}`);
  console.log(`  slug=${a.slug} status=${a.status} programme=${a.programme ?? "(none)"}`);

  const blocking = await prisma.mergeJob.findMany({
    where: { assignmentId: a.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  console.log(`\nJobs holding the merge lock: ${blocking.length}`);
  for (const j of blocking) console.log(`  v${j.version} ${j.status}/${j.step} id=${j.id}`);

  const subs = await prisma.submission.findMany({
    where: { assignmentId: a.id, status: { in: ["CONVERTED", "UPLOADED"] } },
    include: { student: true },
  });
  const missing = subs.filter((s) => !s.pdfDriveFileId);
  console.log(`\nMergeable submissions: ${subs.length}`);
  console.log(`  without a converted PDF: ${missing.length}`);
  for (const s of missing) console.log(`    ${s.student.enrollmentNo} ${s.student.name}`);

  const pages = subs.reduce((n, s) => n + (s.pageCount ?? 0), 0);
  console.log(`  submitted pages (excl. cover/toc/separators): ${pages}`);

  const nextVersion = (await prisma.mergeJob.count({ where: { assignmentId: a.id } })) + 1;
  console.log(`\nNext merge version would be: v${nextVersion}`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

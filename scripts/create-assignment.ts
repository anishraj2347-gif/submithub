/**
 * Creates an assignment and eagerly provisions its Google Drive folder tree,
 * so the CR can see the folders before anyone submits.
 *
 *   npx tsx -r dotenv/config scripts/create-assignment.ts "C++ assignment" [course] [dueISO]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDrive, ensureAssignmentTree } from "../src/lib/drive";
import { slugify } from "../src/lib/utils";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const title = process.argv[2];
  if (!title) throw new Error('Usage: create-assignment.ts "<title>" [course] [dueISO]');
  const course = process.argv[3] ?? "";
  const dueAt = process.argv[4] ? new Date(process.argv[4]) : null;

  const drive = await getDrive();
  const tree = await ensureAssignmentTree(drive, course, title);

  const assignment = await prisma.assignment.upsert({
    where: { slug: slugify(title) },
    update: { title, course, dueAt, driveFolderId: tree.assignmentId, status: "OPEN" },
    create: {
      title,
      slug: slugify(title),
      course,
      dueAt,
      driveFolderId: tree.assignmentId,
      status: "OPEN",
    },
  });

  // Only one assignment should be open for submissions at a time.
  const closed = await prisma.assignment.updateMany({
    where: { id: { not: assignment.id }, status: "OPEN" },
    data: { status: "CLOSED" },
  });

  console.log(`\nAssignment:  ${assignment.title}`);
  console.log(`Slug:        ${assignment.slug}   (files -> <enroll>_<name>_${assignment.slug}.pdf)`);
  console.log(`Due:         ${dueAt ? dueAt.toLocaleString() : "no due date"}`);
  console.log(`Drive folder: https://drive.google.com/drive/folders/${tree.assignmentId}`);
  console.log(`  submissions/ ${tree.submissions}`);
  console.log(`  normalized/  ${tree.normalized}`);
  console.log(`  final/       ${tree.final}`);
  if (closed.count) console.log(`\nClosed ${closed.count} previously open assignment(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

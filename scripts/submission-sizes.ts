/**
 * Ranks the submissions behind a merge by stored size, to show where a heavy
 * final PDF comes from. Reads only what the submission rows already record.
 *
 *   DATABASE_URL="..." npx tsx scripts/submission-sizes.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const mb = (n: number) => (n / 1024 / 1024).toFixed(1).padStart(6);

async function main() {
  const a = await prisma.assignment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  const subs = await prisma.submission.findMany({
    where: { assignmentId: a.id, status: { in: ["CONVERTED", "UPLOADED"] } },
    include: { student: true },
  });

  const rows = subs
    .map((s) => ({
      who: `${s.student.enrollmentNo} ${s.student.name}`,
      bytes: s.sizeBytes ?? 0,
      pages: s.pageCount ?? 0,
      file: s.originalFilename,
    }))
    .sort((x, y) => y.bytes - x.bytes);

  const total = rows.reduce((n, r) => n + r.bytes, 0);
  console.log(`${rows.length} submissions, ${mb(total)} MB stored in total\n`);
  console.log("    MB   pages   per-page KB  student");
  for (const r of rows) {
    const perPage = r.pages ? Math.round(r.bytes / r.pages / 1024) : 0;
    const flag = perPage > 500 ? "  <- image-heavy" : "";
    console.log(
      `${mb(r.bytes)}  ${String(r.pages).padStart(5)}  ${String(perPage).padStart(11)}  ${r.who}${flag}`
    );
  }
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

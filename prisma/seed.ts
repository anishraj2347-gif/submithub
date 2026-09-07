/**
 * Loads the class roster from prisma/roster.csv.
 *
 * Columns: enrollmentNo,name,email   (email may be blank)
 * A student with no email cannot sign in yet — fill it in and re-run.
 * The CR is whoever matches CR_EMAIL (default: the address in the CSV).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs";
import path from "node:path";
import { naturalKey } from "../src/lib/utils";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CR_EMAIL = (process.env.CR_EMAIL ?? "").toLowerCase();

type Row = { enrollmentNo: string; name: string; email: string | null };

function readRoster(): Row[] {
  const file = path.join(__dirname, "roster.csv");
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  lines.shift(); // header
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const [enrollmentNo, name, email] = line.split(",").map((v) => (v ?? "").trim());
      return {
        enrollmentNo,
        name,
        email: email ? email.toLowerCase() : null,
      };
    });
}

async function main() {
  const rows = readRoster();
  if (rows.length === 0) throw new Error("roster.csv is empty");

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.enrollmentNo)) throw new Error(`Duplicate enrollment number: ${r.enrollmentNo}`);
    seen.add(r.enrollmentNo);
  }

  // Remove anyone no longer on the roster, but never someone who has submitted.
  const stale = await prisma.student.findMany({
    where: { isRosterMember: true, enrollmentNo: { notIn: rows.map((r) => r.enrollmentNo) } },
    include: { _count: { select: { submissions: true } } },
  });
  for (const s of stale) {
    if (s._count.submissions > 0) {
      console.warn(`  kept ${s.enrollmentNo} (${s.name}) — off the roster but has submissions`);
      continue;
    }
    await prisma.student.delete({ where: { id: s.id } });
  }

  for (const r of rows) {
    const role = r.email === CR_EMAIL ? ("CR" as const) : ("STUDENT" as const);
    await prisma.student.upsert({
      where: { enrollmentNo: r.enrollmentNo },
      update: { name: r.name, email: r.email, role, sortKey: naturalKey(r.enrollmentNo) },
      create: {
        enrollmentNo: r.enrollmentNo,
        name: r.name,
        email: r.email,
        role,
        sortKey: naturalKey(r.enrollmentNo),
      },
    });
  }

  const total = await prisma.student.count();
  const withEmail = await prisma.student.count({ where: { NOT: { email: null } } });
  const cr = await prisma.student.findFirst({ where: { role: "CR" } });

  console.log(`\nRoster: ${total} students, ${withEmail} with an email (${total - withEmail} cannot sign in yet).`);
  console.log(`CR: ${cr ? `${cr.enrollmentNo} ${cr.name} <${cr.email}>` : "NONE — no roster row matches CR_EMAIL"}`);
  if (stale.length) console.log(`Removed ${stale.length} student(s) no longer on the roster.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * Issues one-time passwords for the roster and writes a distribution sheet.
 *
 *   npx tsx -r dotenv/config scripts/set-passwords.ts            # only students without one
 *   npx tsx -r dotenv/config scripts/set-passwords.ts --all      # reset everyone
 *   npx tsx -r dotenv/config scripts/set-passwords.ts A00000000001   # reset one student
 *
 * Plaintext passwords exist only in the generated CSV — the database stores
 * scrypt hashes. Delete the CSV once you have handed the passwords out.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs";
import path from "node:path";
import { generatePassword, hashPassword } from "../src/lib/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const only = args.filter((a) => !a.startsWith("--"));

  const students = await prisma.student.findMany({
    where: only.length
      ? { enrollmentNo: { in: only } }
      : all
        ? {}
        : { passwordHash: null },
    orderBy: { sortKey: "asc" },
  });

  if (students.length === 0) {
    console.log("Nothing to do — every selected student already has a password.");
    return;
  }

  const rows: string[] = ["enrollmentNo,name,password"];
  for (const s of students) {
    const password = generatePassword(10);
    await prisma.student.update({
      where: { id: s.id },
      data: { passwordHash: hashPassword(password), mustChangePassword: true },
    });
    rows.push(`${s.enrollmentNo},"${s.name}",${password}`);
  }

  const out = path.join(process.cwd(), "passwords.csv");
  fs.writeFileSync(out, rows.join("\n") + "\n", { mode: 0o600 });

  console.log(`\nIssued ${students.length} password(s).`);
  console.log(`Distribution sheet: ${out}  (chmod 600)`);
  console.log(`Delete it once handed out:  rm "${out}"`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

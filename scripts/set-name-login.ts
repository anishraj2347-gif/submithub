/**
 * Login pattern for the class: user = name, password = enrollment number.
 *
 * Names are not unique on this roster, so any student sharing a name gets a
 * numbered alias ("Jane Doe 30") in loginId. Everyone can also sign in
 * with their enrollment number as the ID.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const students = await prisma.student.findMany({
    where: { isRosterMember: true },
    orderBy: { sortKey: "asc" },
  });

  // Which names are shared?
  const byName = new Map<string, typeof students>();
  for (const s of students) {
    const key = s.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), s]);
  }

  const rows: string[] = ["loginId,name,enrollmentNo,password"];
  const collisions: string[] = [];

  for (const s of students) {
    const shared = (byName.get(s.name.trim().toLowerCase()) ?? []).length > 1;

    // Keep an existing CR alias; otherwise disambiguate a shared name.
    let loginId = s.loginId;
    if (!loginId && shared) {
      loginId = `${s.name} ${s.enrollmentNo.slice(-2)}`;
      collisions.push(`${s.enrollmentNo}  ->  "${loginId}"`);
    }

    await prisma.student.update({
      where: { id: s.id },
      data: {
        loginId,
        // Password is the enrollment number, as requested.
        passwordHash: hashPassword(s.enrollmentNo),
        mustChangePassword: true,
      },
    });

    rows.push(`"${loginId ?? s.name}","${s.name}",${s.enrollmentNo},${s.enrollmentNo}`);
  }

  fs.writeFileSync("logins.csv", rows.join("\n") + "\n", { mode: 0o600 });

  console.log(`\nSet name/enrollment login for ${students.length} students.`);
  if (collisions.length) {
    console.log("\nShared names given a numbered ID:");
    collisions.forEach((c) => console.log("  " + c));
  }
  console.log("\nSheet written to logins.csv");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * Splits the admin account away from the roster student who shares its email.
 *
 * Before: one row is both a class member and the admin, so the admin cannot
 * submit as a student and the student cannot be counted separately.
 *
 * After:
 *   - the roster row goes back to being an ordinary student (email cleared,
 *     password back to the class pattern) and can submit like anyone else
 *   - a separate staff-only row holds the admin email, flagged
 *     isRosterMember: false so it stays out of counts, the dashboard table
 *     and merge candidates
 *
 *   ADMIN_EMAIL="you@gmail.com" npx tsx -r dotenv/config scripts/separate-admin.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { defaultCredentials } from "../src/lib/credentials";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("Set ADMIN_EMAIL");

  const existing = await prisma.student.findFirst({ where: { email } });

  if (existing?.isRosterMember) {
    // Free the email first: it is unique, so the new admin row cannot take it
    // while the student still holds it.
    const asStudent = { ...existing, role: "STUDENT" as const, loginId: null };
    const { user, password } = defaultCredentials(asStudent);

    await prisma.student.update({
      where: { id: existing.id },
      data: {
        email: null,
        role: "STUDENT",
        loginId: null,
        passwordHash: hashPassword(password),
        passwordIsDefault: true,
        passwordEnc: null,
        mustChangePassword: true,
      },
    });
    console.log(`  student  ${existing.enrollmentNo}  ${existing.name}`);
    console.log(`           signs in as "${user}" / "${password}"`);
  } else if (existing) {
    console.log(`  admin row already separate: ${existing.enrollmentNo}`);
  }

  // Create (or keep) the staff-only admin row.
  const staff = await prisma.student.findFirst({
    where: { email, isRosterMember: false },
  });

  if (!staff) {
    const count = await prisma.student.count({ where: { isRosterMember: false } });
    const created = await prisma.student.create({
      data: {
        name: "Admin",
        enrollmentNo: `ADMIN-${count + 1}`,
        email,
        role: "ADMIN",
        isRosterMember: false,
        mustChangePassword: false,
        passwordIsDefault: false,
      },
    });
    console.log(`  admin    ${created.enrollmentNo}  <${email}>  (not a class member)`);
  } else {
    await prisma.student.update({ where: { id: staff.id }, data: { role: "ADMIN" } });
    console.log(`  admin    ${staff.enrollmentNo}  <${email}>  (already existed)`);
  }

  const roster = await prisma.student.count({ where: { isRosterMember: true } });
  const staffOnly = await prisma.student.count({ where: { isRosterMember: false } });
  const byRole = await prisma.student.groupBy({ by: ["role"], _count: true });
  console.log(`\n  roster members: ${roster}   staff-only rows: ${staffOnly}`);
  console.log("  " + byRole.map((r) => `${r.role}=${r._count}`).join("  "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

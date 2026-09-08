/**
 * Gives each class rep two separate logins.
 *
 * A CR is also a student who has to submit their own work, but one account
 * cannot be both: staff are redirected away from /submit. So the CR identity
 * moves onto its own staff-only row and the roster row goes back to being an
 * ordinary student.
 *
 *   Dev signs in as "CR - Dev" / "Dev - A45304925011"      -> dashboard
 *   Dev signs in as "Dev Prakash Thakur" / "A45304925011"  -> submit page
 *
 *   CRS="A45304925011:CR - Dev,A45304925016:CR - Anshika" \
 *   npx tsx -r dotenv/config scripts/separate-cr.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { crPassword, defaultCredentials } from "../src/lib/credentials";
import { seal } from "../src/lib/secretbox";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function parseCrs(): { enrollmentNo: string; loginId: string }[] {
  const raw = (process.env.CRS ?? "").trim();
  if (!raw) throw new Error('Set CRS="ENROLLMENT:CR - Name,..."');
  return raw.split(",").map((pair) => {
    const [enrollmentNo, ...rest] = pair.split(":");
    const loginId = rest.join(":").trim();
    if (!enrollmentNo?.trim() || !loginId) throw new Error(`Bad CRS entry: "${pair}"`);
    return { enrollmentNo: enrollmentNo.trim(), loginId };
  });
}

async function main() {
  for (const { enrollmentNo, loginId } of parseCrs()) {
    const rosterRow = await prisma.student.findUnique({ where: { enrollmentNo } });
    if (!rosterRow) throw new Error(`No roster row for ${enrollmentNo}`);

    // The CR password keeps referencing their real enrollment number, which is
    // what everyone has been told — not the synthetic staff-row id.
    const password = crPassword(loginId, enrollmentNo);

    // 1. Free the alias so the staff row can take it (loginId is unique).
    if (rosterRow.loginId) {
      await prisma.student.update({ where: { id: rosterRow.id }, data: { loginId: null } });
    }

    // 2. Roster row becomes an ordinary student again.
    const asStudent = { ...rosterRow, role: "STUDENT" as const, loginId: null };
    const studentCreds = defaultCredentials(asStudent);
    await prisma.student.update({
      where: { id: rosterRow.id },
      data: {
        role: "STUDENT",
        loginId: null,
        passwordHash: hashPassword(studentCreds.password),
        passwordIsDefault: true,
        passwordEnc: null,
      },
    });

    // 3. Staff-only row carries the CR identity.
    const staffEnrollment = `CR-${enrollmentNo}`;
    await prisma.student.upsert({
      where: { enrollmentNo: staffEnrollment },
      update: {
        name: rosterRow.name,
        loginId,
        role: "CR",
        passwordHash: hashPassword(password),
        passwordEnc: seal(password),
        passwordIsDefault: false,
        isRosterMember: false,
      },
      create: {
        name: rosterRow.name,
        enrollmentNo: staffEnrollment,
        loginId,
        role: "CR",
        passwordHash: hashPassword(password),
        passwordEnc: seal(password),
        passwordIsDefault: false,
        isRosterMember: false,
        sortKey: `ZZZ-${staffEnrollment}`,
      },
    });

    console.log(`  ${rosterRow.name}`);
    console.log(`    as CR      "${loginId}" / "${password}"`);
    console.log(`    as student "${studentCreds.user}" / "${studentCreds.password}"`);
  }

  const roster = await prisma.student.count({ where: { isRosterMember: true } });
  const staff = await prisma.student.count({ where: { isRosterMember: false } });
  const byRole = await prisma.student.groupBy({ by: ["role"], _count: true });
  console.log(`\n  roster members: ${roster}   staff-only rows: ${staff}`);
  console.log("  " + byRole.map((r) => `${r.role}=${r._count}`).join("  "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

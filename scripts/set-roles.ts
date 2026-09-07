/**
 * Assigns the CR / ADMIN roles for a class.
 *
 * CRs sign in with a friendly alias ("CR - Sam"); the password is that same
 * first name followed by their enrollment number ("Sam - A00000000001").
 *
 * Configure through the environment so no real roster data lives in the repo:
 *
 *   CRS="A00000000001:CR - Sam,A00000000002:CR - Alex" \
 *   ADMIN_EMAIL="you@gmail.com" \
 *   npx tsx -r dotenv/config scripts/set-roles.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { crPassword } from "../src/lib/credentials";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** "A000...001:CR - Sam,A000...002:CR - Alex" */
function parseCrs(): { enrollmentNo: string; loginId: string }[] {
  const raw = (process.env.CRS ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((pair) => {
    const [enrollmentNo, ...rest] = pair.split(":");
    const loginId = rest.join(":").trim();
    if (!enrollmentNo?.trim() || !loginId) {
      throw new Error(`Bad CRS entry: "${pair}" — expected ENROLLMENT:CR - Name`);
    }
    return { enrollmentNo: enrollmentNo.trim(), loginId };
  });
}

async function main() {
  const crs = parseCrs();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  if (crs.length === 0 && !adminEmail) {
    console.log("Nothing to do. Set CRS and/or ADMIN_EMAIL — see the header of this file.");
    return;
  }

  for (const cr of crs) {
    const s = await prisma.student.findUnique({ where: { enrollmentNo: cr.enrollmentNo } });
    if (!s) throw new Error(`No roster row for ${cr.enrollmentNo}`);
    const password = crPassword(cr.loginId, cr.enrollmentNo);
    await prisma.student.update({
      where: { id: s.id },
      data: {
        role: "CR",
        loginId: cr.loginId,
        passwordHash: hashPassword(password),
        mustChangePassword: true,
        passwordIsDefault: true,
        passwordEnc: null,
      },
    });
    console.log(`  CR    user "${cr.loginId}"  ->  password "${password}"   (${s.name})`);
  }

  if (adminEmail) {
    const admin = await prisma.student.findFirst({ where: { email: adminEmail } });
    if (!admin) throw new Error(`No roster row with email ${adminEmail}`);
    await prisma.student.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    console.log(`  ADMIN ${admin.name} (${admin.enrollmentNo}) <${admin.email}>`);
  }

  const counts = await prisma.student.groupBy({ by: ["role"], _count: true });
  console.log("\n  " + counts.map((c) => `${c.role}: ${c._count}`).join("   "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

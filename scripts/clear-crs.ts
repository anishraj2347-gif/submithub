/**
 * Demotes every CR back to a plain student, so the CRs can be appointed again
 * by hand from Settings.
 *
 *   npx tsx -r dotenv/config scripts/clear-crs.ts
 *
 * Each one loses the CR alias and goes back to signing in with their name and
 * their enrollment number as the password — the same thing the "Remove" button
 * in the Class representatives card does, but for all of them at once.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const crs = await prisma.student.findMany({ where: { role: "CR" } });
  if (crs.length === 0) {
    console.log("No CRs to remove.");
    return;
  }

  for (const cr of crs) {
    await prisma.student.update({
      where: { id: cr.id },
      data: {
        role: "STUDENT",
        loginId: null,
        passwordHash: hashPassword(cr.enrollmentNo),
        mustChangePassword: true,
        passwordIsDefault: true,
        passwordEnc: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CR_REVOKED",
        targetType: "Student",
        targetId: cr.id,
        metadata: { enrollmentNo: cr.enrollmentNo, loginId: cr.loginId, via: "clear-crs script" },
      },
    });

    console.log(`Removed CR access: ${cr.loginId ?? cr.name} (${cr.enrollmentNo})`);
  }

  console.log(`\n${crs.length} CR${crs.length === 1 ? "" : "s"} removed. Add them again from Settings.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

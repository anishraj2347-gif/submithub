import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { defaultCredentials } from "@/lib/credentials";
import { seal } from "@/lib/secretbox";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.union([
  z.object({
    id: z.string().min(1),
    // Blank means "put it back to the default for this person's role".
    password: z.string().max(72).optional(),
  }),
  z.object({ all: z.literal(true) }),
]);

/** Set, reset, or bulk-reset passwords. Admin accounts are left alone. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // ---- bulk: everyone back onto the documented pattern ----
  if ("all" in parsed.data) {
    const people = await prisma.student.findMany({
      where: { isRosterMember: true, role: { not: "ADMIN" } },
    });

    for (const person of people) {
      const { password } = defaultCredentials(person);
      await prisma.student.update({
        where: { id: person.id },
        data: {
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          passwordIsDefault: true,
          // Back on the pattern, so the stored display copy is redundant.
          passwordEnc: null,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "PASSWORD_RESET_ALL",
        metadata: { count: people.length },
      },
    });

    return NextResponse.json({ ok: true, count: people.length });
  }

  // ---- one person ----
  const person = await prisma.student.findUnique({ where: { id: parsed.data.id } });
  if (!person) return NextResponse.json({ error: "No such person" }, { status: 404 });
  if (person.role === "ADMIN") {
    return NextResponse.json(
      { error: "Admins sign in with Google and have no password to reset" },
      { status: 400 }
    );
  }

  const custom = parsed.data.password?.trim();
  if (custom && custom.length < 4) {
    return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
  }

  const password = custom || defaultCredentials(person).password;

  await prisma.student.update({
    where: { id: person.id },
    data: {
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      passwordIsDefault: !custom,
      // Keep a sealed copy of a custom password so the admin can read it back.
      passwordEnc: custom ? seal(custom) : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorEmail: admin.email,
      action: custom ? "PASSWORD_SET" : "PASSWORD_RESET",
      targetType: "Student",
      targetId: person.id,
      metadata: { enrollmentNo: person.enrollmentNo, custom: Boolean(custom) },
    },
  });

  return NextResponse.json({ ok: true, name: person.name, password });
}

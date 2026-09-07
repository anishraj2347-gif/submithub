import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { crPassword } from "@/lib/credentials";

export const runtime = "nodejs";

const addSchema = z.object({
  enrollmentNo: z.string().trim().min(1),
  loginId: z.string().trim().min(2).max(40),
});
const removeSchema = z.object({ id: z.string().min(1) });

/** Promote a roster student to CR with a sign-in alias and matching password. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Pick a student and a CR ID" },
      { status: 400 }
    );
  }
  const { enrollmentNo, loginId } = parsed.data;

  const student = await prisma.student.findUnique({ where: { enrollmentNo } });
  if (!student) return NextResponse.json({ error: "No student with that enrollment number" }, { status: 404 });
  if (student.role === "ADMIN") {
    return NextResponse.json({ error: "That person is an admin already" }, { status: 409 });
  }

  const clash = await prisma.student.findFirst({
    where: { loginId: { equals: loginId, mode: "insensitive" }, NOT: { id: student.id } },
  });
  if (clash) return NextResponse.json({ error: "That CR ID is already taken" }, { status: 409 });

  const password = crPassword(loginId, student.enrollmentNo);
  await prisma.student.update({
    where: { id: student.id },
    data: {
      role: "CR",
      loginId,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      passwordIsDefault: true,
      passwordEnc: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "CR_GRANTED",
      targetType: "Student",
      targetId: student.id,
      metadata: { enrollmentNo, loginId },
    },
  });

  return NextResponse.json({ ok: true, name: student.name, loginId, password });
}

/** Demote a CR back to student: alias cleared, password back to enrollment number. */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const cr = await prisma.student.findUnique({ where: { id: parsed.data.id } });
  if (!cr || cr.role !== "CR") {
    return NextResponse.json({ error: "That person is not a CR" }, { status: 404 });
  }

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
      actorId: admin.id,
      actorEmail: admin.email,
      action: "CR_REVOKED",
      targetType: "Student",
      targetId: cr.id,
      metadata: { enrollmentNo: cr.enrollmentNo, loginId: cr.loginId },
    },
  });

  return NextResponse.json({ ok: true, name: cr.name, enrollmentNo: cr.enrollmentNo });
}

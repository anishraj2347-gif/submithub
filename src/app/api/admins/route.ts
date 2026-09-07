import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const addSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const removeSchema = z.object({ id: z.string().min(1) });

/** Grant admin to a Google address. Roster members are promoted in place. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const { email } = parsed.data;

  const existing = await prisma.student.findFirst({ where: { email } });
  if (existing) {
    if (existing.role === "ADMIN") {
      return NextResponse.json({ error: "That address is already an admin" }, { status: 409 });
    }
    const updated = await prisma.student.update({
      where: { id: existing.id },
      data: { role: "ADMIN" },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "ADMIN_GRANTED",
        targetType: "Student",
        targetId: updated.id,
        metadata: { email, promotedFrom: existing.role },
      },
    });
    return NextResponse.json({ ok: true, promoted: true });
  }

  // Not on the roster: create a staff-only record so it never appears in
  // class counts, the submissions table, or merge candidates.
  const count = await prisma.student.count({ where: { isRosterMember: false } });
  const created = await prisma.student.create({
    data: {
      name: email.split("@")[0],
      enrollmentNo: `ADMIN-${count + 1}-${Date.now().toString(36).slice(-4)}`,
      email,
      role: "ADMIN",
      isRosterMember: false,
      mustChangePassword: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "ADMIN_CREATED",
      targetType: "Student",
      targetId: created.id,
      metadata: { email },
    },
  });

  return NextResponse.json({ ok: true, promoted: false });
}

/** Revoke admin. Roster members drop back to student; staff-only rows are deleted. */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.id === admin.id) {
    return NextResponse.json({ error: "You cannot remove your own admin access" }, { status: 400 });
  }

  const target = await prisma.student.findUnique({ where: { id: parsed.data.id } });
  if (!target || target.role !== "ADMIN") {
    return NextResponse.json({ error: "That admin no longer exists" }, { status: 404 });
  }

  const remaining = await prisma.student.count({ where: { role: "ADMIN" } });
  if (remaining <= 1) {
    return NextResponse.json({ error: "There must be at least one admin" }, { status: 400 });
  }

  if (target.isRosterMember) {
    await prisma.student.update({ where: { id: target.id }, data: { role: "STUDENT" } });
  } else {
    await prisma.student.delete({ where: { id: target.id } });
  }

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "ADMIN_REVOKED",
      targetType: "Student",
      targetId: target.id,
      metadata: { email: target.email, wasRosterMember: target.isRosterMember },
    },
  });

  return NextResponse.json({ ok: true });
}

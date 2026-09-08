import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getDriveContext,
  ensureAssignmentTree,
  uploadOrReplace,
  convertToPdf,
  DriveNotConnectedError,
} from "@/lib/drive";
import { MAX_UPLOAD_BYTES, sniffKind, mimeForKind } from "@/lib/filetypes";
import { buildStoredFilename } from "@/lib/utils";

export const runtime = "nodejs";

/** Thrown inside the upload block so Drive cleanup always runs before responding. */
class UserFacingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export const maxDuration = 60;

const schema = z.object({
  assignmentId: z.string().min(1),
  enrollmentNo: z.string().min(1),
  // A student may correct the spelling of their own name; identity still comes
  // from the session, never from this field.
  name: z.string().trim().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission" }, { status: 400 });
  }

  const parsed = schema.safeParse({
    assignmentId: form.get("assignmentId"),
    enrollmentNo: form.get("enrollmentNo"),
    name: form.get("name") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing assignment or enrollment number" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1048576).toFixed(1)} MB — the limit is 25 MB` },
      { status: 413 }
    );
  }

  const student = await prisma.student.findUnique({ where: { id: user.id } });
  if (!student) return NextResponse.json({ error: "You are not on the roster" }, { status: 403 });

  // A student may only ever submit under their own enrollment number. The
  // field is editable so it can be checked, not so it can be changed.
  if (student.enrollmentNo.toUpperCase() !== parsed.data.enrollmentNo.toUpperCase()) {
    return NextResponse.json(
      {
        error: `That enrollment number is not yours. Yours is ${student.enrollmentNo}.`,
      },
      { status: 403 }
    );
  }

  // Persist a corrected spelling so it appears on the dashboard, the stored
  // filename and the separator pages of the merged document.
  const correctedName = parsed.data.name?.trim();
  if (correctedName && correctedName !== student.name) {
    const clash = await prisma.student.findFirst({
      where: { name: correctedName, isRosterMember: true, NOT: { id: student.id } },
    });
    // Two roster members sharing a name would break name-based sign-in for
    // both of them, so keep the roster name in that case.
    if (!clash) {
      await prisma.student.update({ where: { id: student.id }, data: { name: correctedName } });
      student.name = correctedName;
    }
  }

  const assignment = await prisma.assignment.findUnique({ where: { id: parsed.data.assignmentId } });
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  if (assignment.status !== "OPEN") {
    return NextResponse.json({ error: "This assignment is closed for submissions" }, { status: 409 });
  }
  if (assignment.dueAt && assignment.dueAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "The due date has passed" }, { status: 409 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffKind(buf, file.name);
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported file. Upload a PDF, DOCX, DOC, ODT, or PPTX." },
      { status: 415 }
    );
  }

  const storedFilename = buildStoredFilename(
    student.enrollmentNo,
    student.name,
    assignment.slug,
    kind
  );

  let drive;
  let auth;
  try {
    ({ drive, auth } = await getDriveContext());
  } catch (err) {
    if (err instanceof DriveNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  // Anything uploaded to Drive before a DB failure is cleaned up below.
  const uploaded: string[] = [];
  try {
    const tree = await ensureAssignmentTree(drive, assignment.course, assignment.title);
    if (!assignment.driveFolderId) {
      await prisma.assignment.update({
        where: { id: assignment.id },
        data: { driveFolderId: tree.assignmentId },
      });
    }

    const original = await uploadOrReplace(drive, {
      name: storedFilename,
      parentId: tree.submissions,
      mimeType: mimeForKind(kind),
      body: buf,
    });
    uploaded.push(original.id);

    // Normalize to PDF immediately so the merge step never has to convert.
    let pdfBytes: Buffer;
    if (kind === "pdf") {
      pdfBytes = buf;
    } else {
      pdfBytes = await convertToPdf(drive, {
        name: storedFilename,
        mimeType: mimeForKind(kind),
        body: buf,
        isPresentation: kind === "pptx",
        // Needed to export documents over Drive's 10 MB export limit.
        auth,
      });
    }

    let pageCount = 0;
    try {
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      if (doc.isEncrypted) throw new Error("encrypted");
      pageCount = doc.getPageCount();
    } catch {
      throw new UserFacingError(
        "That PDF is password-protected or corrupt and cannot be merged. Remove the password and try again.",
        422
      );
    }
    if (pageCount === 0) {
      throw new UserFacingError("That file has no readable pages", 422);
    }

    const pdfName = storedFilename.replace(/\.[^.]+$/, ".pdf");
    const normalized = await uploadOrReplace(drive, {
      name: pdfName,
      parentId: tree.normalized,
      mimeType: "application/pdf",
      body: pdfBytes,
    });
    uploaded.push(normalized.id);

    const existing = await prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
    });

    const submission = await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
      update: {
        originalFilename: file.name,
        storedFilename,
        driveFileId: original.id,
        driveWebViewLink: original.webViewLink,
        pdfDriveFileId: normalized.id,
        mimeType: mimeForKind(kind),
        sizeBytes: file.size,
        pageCount,
        status: "CONVERTED",
        error: null,
        version: { increment: 1 },
        submittedAt: new Date(),
      },
      create: {
        assignmentId: assignment.id,
        studentId: student.id,
        originalFilename: file.name,
        storedFilename,
        driveFileId: original.id,
        driveWebViewLink: original.webViewLink,
        pdfDriveFileId: normalized.id,
        mimeType: mimeForKind(kind),
        sizeBytes: file.size,
        pageCount,
        status: "CONVERTED",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: student.id,
        actorEmail: student.email,
        action: existing ? "SUBMISSION_REPLACED" : "SUBMISSION_CREATED",
        targetType: "Submission",
        targetId: submission.id,
        metadata: { storedFilename, pageCount, version: submission.version },
      },
    });

    return NextResponse.json({
      ok: true,
      replaced: Boolean(existing),
      submission: {
        storedFilename,
        pageCount,
        sizeBytes: file.size,
        submittedAt: submission.submittedAt,
        webViewLink: original.webViewLink,
        version: submission.version,
      },
    });
  } catch (err) {
    // Do not leave orphaned Drive files behind a failed submission.
    for (const id of uploaded) {
      await drive.files.delete({ fileId: id }).catch(() => {});
    }
    if (err instanceof UserFacingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[submission]", err);
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}

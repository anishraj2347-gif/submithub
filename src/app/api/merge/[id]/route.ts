import { NextResponse } from "next/server";
import { requireCR } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const job = await prisma.mergeJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    totalPages: job.totalPages,
    outputFilename: job.outputFilename,
    outputUrl: job.outputUrl,
    error: job.error,
    version: job.version,
    count: job.includedSubmissions.length,
    pageMap: job.pageMap,
  });
}

/**
 * Stop a merge that is still in flight. The worker has no abort handle, so
 * this only flips the status — `runMergeJob` notices at its next checkpoint
 * and unwinds itself. The job therefore keeps running for a moment after
 * this returns, which is why the UI keeps polling instead of assuming.
 */
export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Only the CR can stop a merge" }, { status: 403 });

  const { id } = await ctx.params;

  // Conditional write: if the job finished between the CR reading the page and
  // pressing the button, we must not stamp CANCELLED over a real result.
  const stopped = await prisma.mergeJob.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", step: "CANCELLING" },
  });

  if (stopped.count === 0) {
    const job = await prisma.mergeJob.findUnique({ where: { id }, select: { status: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(
      { error: `This merge is already ${job.status.toLowerCase()} and cannot be stopped.` },
      { status: 409 }
    );
  }

  await prisma.auditLog.create({
    data: {
      actorId: cr.id,
      actorEmail: cr.email,
      action: "MERGE_CANCELLED",
      targetType: "MergeJob",
      targetId: id,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * Remove a merge from SubmitHub's history. The generated PDF is deliberately
 * left in the Drive `final` folder — deleting the record is a bookkeeping
 * action, not a way to destroy the only copy of a document.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Only the CR can delete a merge" }, { status: 403 });

  const { id } = await ctx.params;
  const job = await prisma.mergeJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // A running job would carry on writing to a row that no longer exists.
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    return NextResponse.json(
      { error: "Stop this merge before deleting it." },
      { status: 409 }
    );
  }

  await prisma.mergeJob.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorId: cr.id,
      actorEmail: cr.email,
      action: "MERGE_DELETED",
      targetType: "MergeJob",
      targetId: id,
      metadata: {
        version: job.version,
        status: job.status,
        // Recorded so the retained Drive file can still be traced back.
        outputFilename: job.outputFilename,
        outputDriveFileId: job.outputDriveFileId,
      },
    },
  });

  return NextResponse.json({ ok: true, driveFileKept: Boolean(job.outputDriveFileId) });
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCR } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runMergeJob, staleJobCutoff } from "@/lib/merge";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  assignmentId: z.string().min(1),
  submissionIds: z.array(z.string().min(1)).min(1, "Select at least one submission to merge"),
  options: z.object({
    coverPage: z.boolean(),
    separators: z.boolean(),
    pageNumbers: z.boolean(),
    tableOfContents: z.boolean(),
  }),
});

export async function POST(req: NextRequest) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Only the CR can merge" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { assignmentId, submissionIds, options } = parsed.data;

  // A job whose worker died would otherwise block every future merge.
  const running = await prisma.mergeJob.findFirst({
    where: {
      assignmentId,
      status: { in: ["QUEUED", "RUNNING"] },
      startedAt: { gte: staleJobCutoff() },
    },
  });
  if (running) {
    return NextResponse.json(
      { error: "A merge is already running for this assignment", jobId: running.id },
      { status: 409 }
    );
  }

  // Only submissions that actually belong to this assignment may be merged.
  const valid = await prisma.submission.findMany({
    where: { id: { in: submissionIds }, assignmentId, status: { in: ["CONVERTED", "UPLOADED"] } },
    select: { id: true },
  });
  const validIds = new Set(valid.map((s) => s.id));
  const ordered = submissionIds.filter((id) => validIds.has(id));
  if (ordered.length === 0) {
    return NextResponse.json({ error: "None of the selected submissions are mergeable" }, { status: 400 });
  }

  const previous = await prisma.mergeJob.count({ where: { assignmentId } });

  const job = await prisma.mergeJob.create({
    data: {
      assignmentId,
      status: "QUEUED",
      version: previous + 1,
      includedSubmissions: ordered,
      createdBy: cr.id,
      pageMap: { options },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: cr.id,
      actorEmail: cr.email,
      action: "MERGE_STARTED",
      targetType: "MergeJob",
      targetId: job.id,
      metadata: { count: ordered.length, version: job.version, options },
    },
  });

  // Kick off the work without blocking the response; the UI polls /api/merge/[id].
  void runMergeJob(job.id);

  return NextResponse.json({ ok: true, jobId: job.id });
}

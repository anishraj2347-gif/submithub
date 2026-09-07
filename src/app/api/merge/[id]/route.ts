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

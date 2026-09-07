import { NextResponse } from "next/server";
import { requireCR } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDrive, downloadFile } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const job = await prisma.mergeJob.findUnique({ where: { id } });
  if (!job?.outputDriveFileId) {
    return NextResponse.json({ error: "No merged file available" }, { status: 404 });
  }

  const drive = await getDrive();
  const bytes = await downloadFile(drive, job.outputDriveFileId);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${job.outputFilename ?? "final.pdf"}"`,
      "Content-Length": String(bytes.length),
    },
  });
}

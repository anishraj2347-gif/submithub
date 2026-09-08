import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { requireCR } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDrive, downloadFileStream } from "@/lib/drive";

export const runtime = "nodejs";
// A merged class document is large and the instance is small; sending it can
// take minutes on a slow connection.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const job = await prisma.mergeJob.findUnique({ where: { id } });
  if (!job?.outputDriveFileId) {
    return NextResponse.json({ error: "No merged file available" }, { status: 404 });
  }

  const drive = await getDrive();
  const { stream, size } = await downloadFileStream(drive, job.outputDriveFileId);

  // Streamed rather than buffered: holding a whole merged PDF in memory (and
  // Node copies it again on the way out) is enough to take down a small
  // instance, which shows up to the CR as a download that simply dies.
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${job.outputFilename ?? "final.pdf"}"`,
    // The bytes come straight from Drive; nothing downstream should re-buffer.
    "Cache-Control": "no-store",
  });
  if (size !== null) headers.set("Content-Length", String(size));

  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(body, { headers });
}

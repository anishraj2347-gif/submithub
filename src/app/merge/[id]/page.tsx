import { redirect, notFound } from "next/navigation";
import { auth, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/shell";
import { ProgressClient } from "./progress-client";

export const dynamic = "force-dynamic";

export default async function MergeJobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!isStaff(session.user.role)) redirect("/submit");

  const { id } = await params;
  const job = await prisma.mergeJob.findUnique({ where: { id } });
  if (!job) notFound();

  return (
    <AppShell user={session.user}>
      <ProgressClient
        initial={{
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
          pageMap: job.pageMap as never,
        }}
      />
    </AppShell>
  );
}

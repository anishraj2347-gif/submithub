import { redirect } from "next/navigation";
import { auth, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { VerifyClient, type Candidate, type Missing } from "./verify-client";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!isStaff(session.user.role)) redirect("/submit");
  const user = session.user;

  const assignment = await prisma.assignment.findFirst({ orderBy: { createdAt: "desc" } });
  if (!assignment) redirect("/dashboard");

  const [students, submissions] = await Promise.all([
    prisma.student.findMany({ where: { isRosterMember: true }, orderBy: { sortKey: "asc" } }),
    prisma.submission.findMany({
      where: { assignmentId: assignment.id },
      include: { student: true },
    }),
  ]);

  const submittedIds = new Set(submissions.map((s) => s.studentId));
  const missing: Missing[] = students
    .filter((s) => !submittedIds.has(s.id))
    .map((s) => ({ enrollmentNo: s.enrollmentNo, name: s.name }));

  // Candidates follow roster order, which is already natural-sorted by enrollment.
  const rank = new Map(students.map((s, i) => [s.id, i]));
  const candidates: Candidate[] = submissions
    .sort((a, b) => (rank.get(a.studentId) ?? 0) - (rank.get(b.studentId) ?? 0))
    .map((s) => ({
      submissionId: s.id,
      enrollmentNo: s.student.enrollmentNo,
      name: s.student.name,
      filename: s.storedFilename,
      pageCount: s.pageCount,
      blocked:
        s.status === "FAILED"
          ? s.error ?? "This submission failed to process"
          : !s.pdfDriveFileId
            ? "No converted PDF is available for this file"
            : s.pageCount === 0
              ? "This file has no readable pages"
              : null,
    }));

  if (candidates.length === 0) {
    return (
      <AppShell user={user}>
        <Card className="p-10 text-center text-sm text-slate-500">
          Nothing has been submitted yet, so there is nothing to merge.
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <VerifyClient
        assignmentId={assignment.id}
        assignmentTitle={assignment.title}
        candidates={candidates}
        missing={missing}
      />
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { auth, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/shell";
import { Badge, Card, EmptyState } from "@/components/ui";
import { SubmitForm } from "./submit-form";

export default async function SubmitPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // CRs and the admin manage submissions, they do not make them.
  if (isStaff(session.user.role)) redirect("/dashboard");
  const user = session.user;

  const assignment = await prisma.assignment.findFirst({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });

  if (!assignment) {
    return (
      <AppShell user={user}>
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title="No open assignment"
            body="There is nothing to submit right now. Check back when the next assignment opens."
          />
        </Card>
      </AppShell>
    );
  }

  const existing = await prisma.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: user.id } },
  });

  const overdue = assignment.dueAt ? assignment.dueAt.getTime() < Date.now() : false;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{assignment.course}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{assignment.title}</h1>
          {assignment.description ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{assignment.description}</p>
          ) : null}
          {assignment.dueAt ? (
            <div className="mt-3">
              <Badge tone={overdue ? "red" : "indigo"}>
                <CalendarClock className="h-3 w-3" />
                {overdue ? "Closed — due " : "Due "}
                {assignment.dueAt.toLocaleString()}
              </Badge>
            </div>
          ) : null}
        </div>

        <SubmitForm
          assignmentId={assignment.id}
          studentName={user.name ?? ""}
          enrollmentNo={user.enrollmentNo}
          existing={
            existing
              ? {
                  storedFilename: existing.storedFilename,
                  pageCount: existing.pageCount,
                  submittedAt: existing.submittedAt.toISOString(),
                  version: existing.version,
                  webViewLink: existing.driveWebViewLink,
                }
              : null
          }
        />
      </div>
    </AppShell>
  );
}

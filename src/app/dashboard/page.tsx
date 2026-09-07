import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users, CheckCircle2, Clock, Timer, FileStack, HardDriveUpload, History, AlertTriangle,
} from "lucide-react";
import { auth, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDriveConnected } from "@/lib/drive";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, CardHeader, CardTitle, StatCard } from "@/components/ui";
import { relativeTime } from "@/lib/utils";
import { RosterTable, type Row } from "./roster-table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!isStaff(session.user.role)) redirect("/submit");
  const user = session.user;

  const assignment = await prisma.assignment.findFirst({ orderBy: { createdAt: "desc" } });
  if (!assignment) {
    return (
      <AppShell user={user}>
        <Card className="p-10 text-center text-sm text-slate-500">No assignment has been created yet.</Card>
      </AppShell>
    );
  }

  const [students, submissions, driveOk, jobs] = await Promise.all([
    prisma.student.findMany({ where: { isRosterMember: true }, orderBy: { sortKey: "asc" } }),
    prisma.submission.findMany({ where: { assignmentId: assignment.id } }),
    isDriveConnected(),
    prisma.mergeJob.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
  ]);

  const byStudent = new Map(submissions.map((s) => [s.studentId, s]));

  const rows: Row[] = students.map((student) => {
    const sub = byStudent.get(student.id);
    return {
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      name: student.name,
      status: !sub ? "PENDING" : sub.status === "FAILED" ? "FAILED" : "SUBMITTED",
      filename: sub?.storedFilename ?? null,
      pageCount: sub?.pageCount ?? null,
      sizeBytes: sub?.sizeBytes ?? null,
      submittedAt: sub?.submittedAt.toISOString() ?? null,
      webViewLink: sub?.driveWebViewLink ?? null,
      version: sub?.version ?? null,
    };
  });

  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const pending = rows.length - submitted;
  const percent = rows.length ? Math.round((submitted / rows.length) * 100) : 0;
  const latest = submissions.reduce<Date | null>(
    (acc, s) => (!acc || s.submittedAt > acc ? s.submittedAt : acc),
    null
  );
  const activeJob = jobs.find((j) => j.status === "QUEUED" || j.status === "RUNNING");

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{assignment.course}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{assignment.title}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {assignment.dueAt ? `Due ${assignment.dueAt.toLocaleString()}` : "No due date"}
            </p>
          </div>

          <Link href="/merge/verify">
            <Button size="lg" disabled={submitted === 0 || Boolean(activeJob)}>
              <FileStack className="h-4 w-4" />
              {activeJob ? "Merge in progress…" : "Generate Final Document"}
            </Button>
          </Link>
        </div>

        {!driveOk ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <HardDriveUpload className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Google Drive is not connected</p>
              <p className="mt-0.5">
                Students cannot submit and nothing can be merged until Drive is connected.{" "}
                <Link href="/settings" className="font-medium underline">
                  Connect it in Settings
                </Link>
                .
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total students" value={rows.length} icon={<Users className="h-4 w-4" />} />
          <StatCard
            label="Submitted"
            value={submitted}
            hint={`${percent}% of the class`}
            tone="green"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <StatCard
            label="Pending"
            value={pending}
            hint={pending === 0 ? "Everyone is in" : "Still missing"}
            tone="amber"
            icon={<Clock className="h-4 w-4" />}
          />
          <StatCard
            label="Last submission"
            value={<span className="text-2xl">{relativeTime(latest)}</span>}
            tone="indigo"
            icon={<Timer className="h-4 w-4" />}
          />
        </div>

        <Card className="p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Submission progress</span>
            <span className="tabular-nums text-slate-500 dark:text-slate-400">
              {submitted} / {rows.length}
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </Card>

        <RosterTable rows={rows} />

        {jobs.length > 0 ? (
          <Card>
            <CardHeader className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              <CardTitle>Merge history</CardTitle>
            </CardHeader>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Badge
                    tone={
                      job.status === "SUCCESS" ? "green" : job.status === "FAILED" ? "red" : "indigo"
                    }
                  >
                    {job.status === "FAILED" ? <AlertTriangle className="h-3 w-3" /> : null}
                    v{job.version} · {job.status}
                  </Badge>
                  <span className="text-slate-600 dark:text-slate-400">
                    {job.includedSubmissions.length} files
                    {job.totalPages ? ` · ${job.totalPages} pages` : ""}
                  </span>
                  <span className="text-xs text-slate-400">{relativeTime(job.startedAt)}</span>
                  <Link
                    href={`/merge/${job.id}`}
                    className="ml-auto text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}

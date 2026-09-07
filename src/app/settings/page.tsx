import { redirect } from "next/navigation";
import { HardDrive, CheckCircle2, AlertTriangle } from "lucide-react";
import { auth, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/shell";
import { AdminsPanel, type AdminRow } from "./admins-panel";
import { CrsPanel, type Person } from "./crs-panel";
import { LoginsPanel, type LoginRow } from "./logins-panel";
import { defaultCredentials } from "@/lib/credentials";
import { open as unseal } from "@/lib/secretbox";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!isStaff(session.user.role)) redirect("/submit");

  const { drive } = await searchParams;
  const cred = await prisma.driveCredential.findUnique({ where: { id: "singleton" } });
  const isAdmin = session.user.role === "ADMIN";
  const adminRows: AdminRow[] = isAdmin
    ? (await prisma.student.findMany({ where: { role: "ADMIN" }, orderBy: { email: "asc" } })).map(
        (a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          enrollmentNo: a.enrollmentNo,
          isRosterMember: a.isRosterMember,
          isSelf: a.id === session.user.id,
        })
      )
    : [];

  const people: Person[] = isAdmin
    ? (
        await prisma.student.findMany({
          where: { isRosterMember: true },
          orderBy: { sortKey: "asc" },
        })
      ).map((p) => ({
        id: p.id,
        name: p.name,
        enrollmentNo: p.enrollmentNo,
        loginId: p.loginId,
        role: p.role,
      }))
    : [];

  const loginRows: LoginRow[] = isAdmin
    ? (
        await prisma.student.findMany({
          where: { isRosterMember: true },
          orderBy: { sortKey: "asc" },
        })
      ).map((p) => {
        const creds = defaultCredentials(p);
        // A custom password is shown from its sealed copy; if that cannot be
        // opened (AUTH_SECRET changed) the row says so rather than lying.
        const custom = p.passwordIsDefault ? null : unseal(p.passwordEnc);
        return {
          id: p.id,
          name: p.name,
          enrollmentNo: p.enrollmentNo,
          role: p.role,
          user: creds.user,
          password: custom ?? creds.password,
          isDefault: p.passwordIsDefault,
          isRecoverable: p.passwordIsDefault || custom !== null,
        };
      })
    : [];
  const students = await prisma.student.count({ where: { isRosterMember: true } });

  return (
    <AppShell user={session.user}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Class configuration and storage connection.
          </p>
        </div>

        {drive === "connected" ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            Google Drive connected successfully.
          </p>
        ) : drive === "norefresh" ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Google did not return a refresh token. Remove SubmitHub from your Google account
            permissions and connect again.
          </p>
        ) : drive === "error" ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            Drive connection failed. Please try again.
          </p>
        ) : null}

        <Card>
          <CardHeader className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-slate-400" />
            <CardTitle>Google Drive storage</CardTitle>
          </CardHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Every submission and every merged document is stored in this Google account&apos;s
              Drive, under <code className="font-mono text-xs">SubmitHub / Course / Assignment</code>.
              Connect the account that should own the class files.
            </p>

            {cred ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900">
                <Badge tone="green">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </Badge>
                <span className="text-sm">{cred.email}</span>
                <a href="/api/drive/connect" className="ml-auto">
                  <Button variant="secondary" size="sm">
                    Reconnect
                  </Button>
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 dark:bg-amber-500/10">
                <Badge tone="amber">
                  <AlertTriangle className="h-3 w-3" /> Not connected
                </Badge>
                <span className="text-sm text-amber-800 dark:text-amber-300">
                  Submissions are blocked until Drive is connected.
                </span>
                <a href="/api/drive/connect" className="ml-auto">
                  <Button size="sm">Connect Google Drive</Button>
                </a>
              </div>
            )}
          </div>
        </Card>

        {isAdmin ? <CrsPanel people={people} /> : null}
        {isAdmin ? <LoginsPanel rows={loginRows} /> : null}
        {isAdmin ? <AdminsPanel admins={adminRows} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Class roster</CardTitle>
          </CardHeader>
          <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
            <p>
              <strong className="tabular-nums">{students}</strong> students are on the roster. Only
              these email addresses can sign in.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Edit the roster in <code className="font-mono">prisma/seed.ts</code> and re-run{" "}
              <code className="font-mono">npx prisma db seed</code>.
            </p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

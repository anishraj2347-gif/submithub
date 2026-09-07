"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Check, ClipboardCopy, KeyRound, Loader2, RotateCcw, Trash2, UserPlus,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";

export type Person = {
  id: string;
  name: string;
  enrollmentNo: string;
  loginId: string | null;
  role: "STUDENT" | "CR" | "ADMIN";
};

export function CrsPanel({ people }: { people: Person[] }) {
  const router = useRouter();
  const crs = people.filter((p) => p.role === "CR");
  const students = people.filter((p) => p.role === "STUDENT");

  const [enrollmentNo, setEnrollmentNo] = React.useState("");
  const [loginId, setLoginId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ user: string; password: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Offer the "CR - Firstname" shape as soon as a student is chosen.
  React.useEffect(() => {
    const s = students.find((p) => p.enrollmentNo === enrollmentNo);
    if (s && !loginId) setLoginId(`CR - ${s.name.split(/\s+/)[0]}`);
  }, [enrollmentNo, students, loginId]);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addCr(e: React.FormEvent) {
    e.preventDefault();
    setIssued(null);
    const data = await call("/api/crs", "POST", { enrollmentNo, loginId });
    if (data) {
      setIssued({ user: data.loginId, password: data.password });
      setEnrollmentNo("");
      setLoginId("");
    }
  }

  async function resetPassword(p: Person) {
    setIssued(null);
    const data = await call("/api/password", "POST", { id: p.id });
    if (data) setIssued({ user: p.loginId ?? p.name, password: data.password });
  }

  async function setCustom(p: Person) {
    const password = prompt(`New password for ${p.loginId ?? p.name}:`);
    if (!password) return;
    setIssued(null);
    const data = await call("/api/password", "POST", { id: p.id, password });
    if (data) setIssued({ user: p.loginId ?? p.name, password: data.password });
  }

  async function removeCr(p: Person) {
    if (!confirm(`Remove CR access for ${p.name}? Their password goes back to their enrollment number.`)) return;
    setIssued(null);
    await call("/api/crs", "DELETE", { id: p.id });
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-slate-400" />
        <CardTitle>Class representatives</CardTitle>
      </CardHeader>

      <div className="space-y-4 p-5">
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {crs.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-500">No CRs yet.</li>
          ) : (
            crs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.loginId ?? p.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {p.name} · {p.enrollmentNo}
                  </span>
                </span>
                <Badge tone="indigo">CR</Badge>
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => resetPassword(p)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCustom(p)}>
                    Set password
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                    onClick={() => removeCr(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={addCr} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Student
            </span>
            <select
              value={enrollmentNo}
              onChange={(e) => {
                setEnrollmentNo(e.target.value);
                setLoginId("");
              }}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Choose a student…</option>
              {students.map((p) => (
                <option key={p.id} value={p.enrollmentNo}>
                  {p.name} — {p.enrollmentNo}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              CR ID
            </span>
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="CR - Name"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
          </label>

          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add CR
          </Button>
        </form>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          The password is set automatically to <code className="font-mono">Name - EnrollmentNo</code>,
          for example <code className="font-mono">Sam - A00000000001</code>.
        </p>

        {issued ? (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm dark:bg-emerald-500/10">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">
              Credentials for {issued.user}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-white px-2 py-1 font-mono text-xs dark:bg-slate-900">
                {issued.user}
              </code>
              <code className="rounded bg-white px-2 py-1 font-mono text-xs dark:bg-slate-900">
                {issued.password}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(`${issued.user} / ${issued.password}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              Shown once — copy it now.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

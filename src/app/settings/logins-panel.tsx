"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Check, ClipboardCopy, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Search, ShieldAlert,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";

export type LoginRow = {
  id: string;
  name: string;
  enrollmentNo: string;
  role: "STUDENT" | "CR" | "ADMIN";
  user: string;
  password: string;
  isDefault: boolean;
  /** False only when a custom password's sealed copy cannot be opened. */
  isRecoverable: boolean;
};

const MASK = "••••••••••";

export function LoginsPanel({ rows }: { rows: LoginRow[] }) {
  const router = useRouter();
  const [reveal, setReveal] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [copied, setCopied] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.enrollmentNo.toLowerCase().includes(q) ||
        r.user.toLowerCase().includes(q)
    );
  }, [rows, query]);

  async function post(body: unknown, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
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
      setBusy(null);
    }
  }

  async function resetOne(r: LoginRow) {
    const data = await post({ id: r.id }, r.id);
    if (data) setNotice(`${r.name} is back on the default password.`);
  }

  async function setOne(r: LoginRow) {
    const password = prompt(`New password for ${r.user}:`);
    if (!password) return;
    const data = await post({ id: r.id, password }, r.id);
    if (data) setNotice(`${r.name}'s password was changed. It cannot be displayed here.`);
  }

  async function resetAll() {
    if (
      !confirm(
        `Reset passwords for all ${rows.filter((r) => r.role !== "ADMIN").length} students and CRs?\n\n` +
          "Everyone goes back to the default pattern. Anyone using a custom password will be signed out of it."
      )
    )
      return;
    const data = await post({ all: true }, "__all__");
    if (data) setNotice(`Reset ${data.count} passwords to the default pattern.`);
  }

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }

  const lostCount = rows.filter((r) => !r.isRecoverable).length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 text-slate-400" />
        <CardTitle>Sign-in details</CardTitle>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal ? "Hide passwords" : "Show passwords"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy !== null} onClick={resetAll}>
            {busy === "__all__" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Reset all
          </Button>
        </span>
      </CardHeader>

      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Default passwords are re-derived from the class pattern; passwords you
          set by hand are stored encrypted so they can be shown here. Sign-in
          itself always checks a one-way hash.
        </p>

        {lostCount > 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {lostCount} {lostCount === 1 ? "password" : "passwords"} cannot be read
            back — they were set before this feature existed, or AUTH_SECRET has
            changed since. Use <strong>Reset</strong> to put them back on the pattern.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, enrollment number, or user ID"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              copy(
                ["user,password", ...rows.filter((r) => r.isRecoverable && r.role !== "ADMIN").map((r) => `"${r.user}",${r.password}`)].join("\n"),
                "__all__"
              )
            }
          >
            {copied === "__all__" ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            Copy all
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Password</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2">
                    <span className="block truncate">{r.name}</span>
                    <span className="block font-mono text-[11px] text-slate-500">{r.enrollmentNo}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{r.user}</span>
                    {r.role !== "STUDENT" ? (
                      <Badge tone={r.role === "ADMIN" ? "indigo" : "neutral"} className="ml-2">
                        {r.role}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {!r.isRecoverable ? (
                      <span className="text-amber-600 dark:text-amber-400">custom — not recoverable</span>
                    ) : r.role === "ADMIN" ? (
                      <span className="text-slate-400">Google sign-in</span>
                    ) : reveal ? (
                      <span className="flex items-center gap-1.5">
                        {r.password}
                        {!r.isDefault ? (
                          <Badge tone="amber" className="font-sans">
                            custom
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      MASK
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.role === "ADMIN" ? null : (
                      <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {r.isRecoverable ? (
                          <button
                            onClick={() => copy(`${r.user} / ${r.password}`, r.id)}
                            className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
                          >
                            {copied === r.id ? "Copied" : "Copy"}
                          </button>
                        ) : null}
                        <button
                          disabled={busy !== null}
                          onClick={() => resetOne(r)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {busy === r.id ? "…" : "Reset"}
                        </button>
                        <button
                          disabled={busy !== null}
                          onClick={() => setOne(r)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Set
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Nobody matches that search.</p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            {notice}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

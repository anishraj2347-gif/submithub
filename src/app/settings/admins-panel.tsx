"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ShieldPlus, Trash2, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";

export type AdminRow = {
  id: string;
  name: string;
  email: string | null;
  enrollmentNo: string;
  isRosterMember: boolean;
  isSelf: boolean;
};

export function AdminsPanel({ admins }: { admins: AdminRow[] }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add that admin");
      setNotice(
        data.promoted
          ? `${email} is now an admin (promoted from the roster).`
          : `${email} can now sign in as an admin with Google.`
      );
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that admin");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove admin access for ${label}?`)) return;
    setError(null);
    setNotice(null);
    const res = await fetch("/api/admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Could not remove that admin");
    setNotice(`Admin access removed for ${label}.`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-slate-400" />
        <CardTitle>Admins</CardTitle>
      </CardHeader>

      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Admins sign in with Google and can see everything a class rep can, plus
          this panel. Add someone by their Google address.
        </p>

        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.email ?? a.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {a.isRosterMember ? `${a.enrollmentNo} · on the roster` : "not a class member"}
                </span>
              </span>
              {a.isSelf ? <Badge tone="indigo">You</Badge> : null}
              {!a.isSelf ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                  onClick={() => remove(a.id, a.email ?? a.name)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              ) : (
                <span className="ml-auto text-xs text-slate-400">cannot remove yourself</span>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Google email address
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />}
            Add admin
          </Button>
        </form>

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

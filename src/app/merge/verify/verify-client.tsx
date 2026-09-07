"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, FileStack, Loader2, UserX,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

export type Candidate = {
  submissionId: string;
  enrollmentNo: string;
  name: string;
  filename: string;
  pageCount: number;
  blocked: string | null;
};

export type Missing = { enrollmentNo: string; name: string };

export function VerifyClient({
  assignmentId,
  assignmentTitle,
  candidates,
  missing,
}: {
  assignmentId: string;
  assignmentTitle: string;
  candidates: Candidate[];
  missing: Missing[];
}) {
  const router = useRouter();
  // Blocked files start excluded, so a CR must act deliberately to include one.
  const [order, setOrder] = React.useState(candidates.map((c) => c.submissionId));
  const [included, setIncluded] = React.useState<Set<string>>(
    () => new Set(candidates.filter((c) => !c.blocked).map((c) => c.submissionId))
  );
  const [options, setOptions] = React.useState({
    coverPage: true,
    separators: true,
    pageNumbers: true,
    tableOfContents: true,
  });
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const byId = React.useMemo(
    () => new Map(candidates.map((c) => [c.submissionId, c])),
    [candidates]
  );
  const orderedIncluded = order.filter((id) => included.has(id));
  const excludedCount = candidates.length - orderedIncluded.length;
  const blockedIncluded = orderedIncluded.filter((id) => byId.get(id)?.blocked);

  const totalPages = orderedIncluded.reduce((sum, id) => sum + (byId.get(id)?.pageCount ?? 0), 0);
  const extraPages =
    (options.coverPage ? 1 : 0) +
    (options.tableOfContents ? Math.max(1, Math.ceil(orderedIncluded.length / 30)) : 0) +
    (options.separators ? orderedIncluded.length : 0);

  // Excluding a classmate is the one destructive-ish choice here, so it needs typing.
  const needsTypedConfirm = excludedCount > 0;
  const confirmOk = !needsTypedConfirm || confirmText.trim().toUpperCase() === "MERGE";
  const canMerge = orderedIncluded.length > 0 && blockedIncluded.length === 0 && confirmOk && !busy;

  function toggle(id: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function move(id: string, dir: -1 | 1) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function startMerge() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, submissionIds: orderedIncluded, options }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the merge");
      router.push(`/merge/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the merge");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Verify before merging</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Nothing is merged until you confirm this screen.
        </p>
      </div>

      <Card className="border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
        <p className="text-sm font-medium">
          {orderedIncluded.length} of {candidates.length + missing.length} submissions will be merged
          into <strong>{assignmentTitle}</strong>.
        </p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Approximately {totalPages + extraPages} pages ({totalPages} submitted + {extraPages} generated).
        </p>
        {missing.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              <UserX className="h-3.5 w-3.5" /> {missing.length} never submitted:
            </span>
            {missing.map((m) => (
              <Badge key={m.enrollmentNo} tone="amber">
                {m.enrollmentNo}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {blockedIncluded.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {blockedIncluded.length} selected file(s) cannot be merged. Uncheck them to continue —
            they cannot be skipped silently.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Merge order (enrollment ascending)</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {order.map((id, index) => {
            const c = byId.get(id);
            if (!c) return null;
            const on = included.has(id);
            return (
              <li
                key={id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  !on && "opacity-50",
                  c.blocked && "bg-red-50/50 dark:bg-red-500/5"
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(id)}
                  aria-label={`Include ${c.enrollmentNo}`}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="w-6 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs font-medium">{c.enrollmentNo}</span>
                    <span className="truncate">{c.name}</span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">{c.filename}</p>
                  {c.blocked ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                      <AlertTriangle className="h-3 w-3" /> {c.blocked}
                    </p>
                  ) : null}
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                  {c.pageCount} pages
                </span>
                <div className="flex flex-col">
                  <button
                    onClick={() => move(id, -1)}
                    aria-label={`Move ${c.enrollmentNo} up`}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => move(id, 1)}
                    aria-label={`Move ${c.enrollmentNo} down`}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Document options</CardTitle>
        </CardHeader>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {(
            [
              ["coverPage", "Insert a cover page"],
              ["separators", "Separator page before each student"],
              ["pageNumbers", "Page numbers in the footer"],
              ["tableOfContents", "Table of contents"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {label}
            </label>
          ))}
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Card className="p-5">
        {needsTypedConfirm ? (
          <div className="mb-4">
            <label className="block text-sm">
              <span className="font-medium">
                {excludedCount} student{excludedCount === 1 ? "" : "s"} will be left out of this
                document.
              </span>
              <span className="mt-1 block text-slate-500 dark:text-slate-400">
                Type <code className="font-mono font-semibold">MERGE</code> to confirm.
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-2 w-48 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
                placeholder="MERGE"
              />
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Link href="/dashboard">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button size="lg" onClick={startMerge} disabled={!canMerge}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
            Merge {orderedIncluded.length} files → Final PDF
          </Button>
        </div>
      </Card>
    </div>
  );
}

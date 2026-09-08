"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, History, Loader2, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { relativeTime } from "@/lib/utils";

export type MergeRow = {
  id: string;
  version: number;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  fileCount: number;
  totalPages: number;
  startedAt: string;
};

const TONE = {
  SUCCESS: "green",
  FAILED: "red",
  CANCELLED: "neutral",
  QUEUED: "indigo",
  RUNNING: "indigo",
} as const;

export function MergeHistory({ jobs }: { jobs: MergeRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/merge/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not delete that merge.");
      setBusy(null);
      return;
    }
    setBusy(null);
    setConfirming(null);
    router.refresh();
  }

  if (jobs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <History className="h-4 w-4 text-slate-400" />
        <CardTitle>Merge history</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {jobs.map((job) => {
          const running = job.status === "QUEUED" || job.status === "RUNNING";
          return (
            <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Badge tone={TONE[job.status]}>
                {job.status === "FAILED" ? <AlertTriangle className="h-3 w-3" /> : null}
                {job.status === "CANCELLED" ? <Ban className="h-3 w-3" /> : null}
                v{job.version} · {job.status}
              </Badge>
              <span className="text-slate-600 dark:text-slate-400">
                {job.fileCount} files
                {job.totalPages ? ` · ${job.totalPages} pages` : ""}
              </span>
              <span className="text-xs text-slate-400">{relativeTime(new Date(job.startedAt))}</span>

              <div className="ml-auto flex items-center gap-3">
                {confirming === job.id ? (
                  <>
                    <span className="text-xs text-slate-500">
                      Remove v{job.version}? The Drive PDF is kept.
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => remove(job.id)}
                      disabled={busy !== null}
                    >
                      {busy === job.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Link
                      href={`/merge/${job.id}`}
                      className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      View
                    </Link>
                    {/* A running job must be stopped on its own page first —
                        deleting the row out from under the worker would strand it. */}
                    {running ? null : (
                      <button
                        type="button"
                        onClick={() => setConfirming(job.id)}
                        className="text-slate-400 transition-colors hover:text-red-600"
                        aria-label={`Delete merge v${job.version}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="px-5 pb-4 text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}

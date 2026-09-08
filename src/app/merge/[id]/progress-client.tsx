"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, AlertTriangle, Download, ExternalLink, Loader2, ArrowLeft, Ban, Trash2,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  step: string;
  progress: number;
  totalPages: number;
  outputFilename: string | null;
  outputUrl: string | null;
  error: string | null;
  version: number;
  count: number;
  pageMap: { entries?: { enrollmentNo: string; name: string; startPage: number; endPage: number }[] } | null;
};

const STEPS = ["FETCHING", "MERGING", "UPLOADING", "DONE"] as const;

const DONE: Job["status"][] = ["SUCCESS", "FAILED", "CANCELLED"];

export function ProgressClient({ initial }: { initial: Job }) {
  const router = useRouter();
  const [job, setJob] = React.useState<Job>(initial);
  const [busy, setBusy] = React.useState<null | "stop" | "delete">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (DONE.includes(job.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/merge/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 1200);
    return () => clearInterval(t);
  }, [job.id, job.status]);

  // The worker only notices a cancel at its next checkpoint, so leave the
  // poller running and let it report the job's own account of itself.
  async function stop() {
    setBusy("stop");
    setError(null);
    const res = await fetch(`/api/merge/${job.id}`, { method: "PATCH" });
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.error ?? "Could not stop this merge.");
    else setJob((j) => ({ ...j, step: "CANCELLING" }));
    setBusy(null);
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    const res = await fetch(`/api/merge/${job.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not delete this merge.");
      setBusy(null);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  const activeIndex = STEPS.indexOf(job.step as (typeof STEPS)[number]);

  const deleteControls = (
    <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
      {confirmDelete ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Remove v{job.version} from the merge history?
          </p>
          <p className="text-xs text-slate-500">
            The PDF stays in the Drive <span className="font-mono">final</span> folder — only this
            record is removed.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" size="sm" onClick={remove} disabled={busy !== null}>
              {busy === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete merge
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Delete this merge
        </Button>
      )}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      {job.status === "FAILED" ? (
        <Card className="border-red-200 p-8 text-center dark:border-red-500/30">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">Merge failed</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">{job.error}</p>
          <p className="mt-2 text-xs text-slate-500">
            No partial document was produced. Fix the file above, then run the merge again.
          </p>
          <div className="mt-6">
            <Link href="/merge/verify">
              <Button variant="secondary">Back to verification</Button>
            </Link>
          </div>
          {deleteControls}
        </Card>
      ) : job.status === "CANCELLED" ? (
        <Card className="p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <Ban className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">Merge stopped</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">
            You stopped this merge before it finished. Nothing was uploaded, and no submission was
            changed.
          </p>
          <div className="mt-6">
            <Link href="/merge/verify">
              <Button variant="secondary">Start a new merge</Button>
            </Link>
          </div>
          {deleteControls}
        </Card>
      ) : job.status === "SUCCESS" ? (
        <>
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-lg font-semibold">Final document ready</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{job.outputFilename}</p>

            <div className="mt-5 flex flex-wrap justify-center gap-6 text-sm">
              <Stat label="Students" value={job.count} />
              <Stat label="Pages" value={job.totalPages} />
              <Stat label="Version" value={`v${job.version}`} />
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <a href={`/api/merge/${job.id}/download`}>
                <Button size="lg">
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
              </a>
              {job.outputUrl ? (
                <a href={job.outputUrl} target="_blank" rel="noreferrer">
                  <Button variant="secondary" size="lg">
                    <ExternalLink className="h-4 w-4" /> Open in Drive
                  </Button>
                </a>
              ) : null}
            </div>
            {deleteControls}
          </Card>

          {job.pageMap?.entries?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Where each student appears</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {job.pageMap.entries.map((e) => (
                  <li key={e.enrollmentNo} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="font-mono text-xs font-medium">{e.enrollmentNo}</span>
                    <span className="truncate text-slate-600 dark:text-slate-300">{e.name}</span>
                    <span className="ml-auto whitespace-nowrap tabular-nums text-xs text-slate-500">
                      p. {e.startPage}–{e.endPage}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : (
        <Card className="p-8">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            <div>
              <h1 className="text-base font-semibold">Generating final document</h1>
              <p className="text-sm text-slate-500">Merging {job.count} submissions — keep this tab open.</p>
            </div>
            <Badge tone="indigo" className="ml-auto">
              v{job.version}
            </Badge>
          </div>

          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${Math.max(job.progress, 5)}%` }}
            />
          </div>

          <ol className="mt-6 grid grid-cols-4 gap-2 text-center text-xs">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "rounded-lg py-2 font-medium capitalize",
                  i < activeIndex && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
                  i === activeIndex && "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
                  i > activeIndex && "bg-slate-100 text-slate-400 dark:bg-slate-800"
                )}
              >
                {s.toLowerCase()}
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            {job.step === "CANCELLING" ? (
              <p className="text-sm text-slate-500">
                Stopping after the current file — this can take a moment.
              </p>
            ) : (
              <Button variant="secondary" size="sm" onClick={stop} disabled={busy !== null}>
                {busy === "stop" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
                Stop merge
              </Button>
            )}
            <p className="text-xs text-slate-500">
              Stopping discards the half-built document. Nothing is uploaded.
            </p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

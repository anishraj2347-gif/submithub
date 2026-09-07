"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2, AlertTriangle, Download, ExternalLink, Loader2, ArrowLeft,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
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

export function ProgressClient({ initial }: { initial: Job }) {
  const [job, setJob] = React.useState<Job>(initial);

  React.useEffect(() => {
    if (job.status === "SUCCESS" || job.status === "FAILED") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/merge/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 1200);
    return () => clearInterval(t);
  }, [job.id, job.status]);

  const activeIndex = STEPS.indexOf(job.step as (typeof STEPS)[number]);

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

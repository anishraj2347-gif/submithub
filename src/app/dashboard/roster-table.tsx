"use client";

import * as React from "react";
import {
  Search, ArrowUpDown, CheckCircle2, Clock, AlertTriangle, ExternalLink, ClipboardCopy, Check,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cn, compareNatural, formatBytes, relativeTime } from "@/lib/utils";

export type Row = {
  studentId: string;
  enrollmentNo: string;
  name: string;
  status: "SUBMITTED" | "PENDING" | "FAILED";
  filename: string | null;
  pageCount: number | null;
  sizeBytes: number | null;
  submittedAt: string | null;
  webViewLink: string | null;
  version: number | null;
};

type SortKey = "enrollmentNo" | "name" | "status" | "pageCount" | "submittedAt";
type Filter = "all" | "submitted" | "pending" | "failed";

export function RosterTable({ rows }: { rows: Row[] }) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("enrollmentNo");
  const [asc, setAsc] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const visible = React.useMemo(() => {
    const q = debounced.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (filter === "submitted" && r.status !== "SUBMITTED") return false;
      if (filter === "pending" && r.status !== "PENDING") return false;
      if (filter === "failed" && r.status !== "FAILED") return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.enrollmentNo.toLowerCase().includes(q) ||
        (r.filename ?? "").toLowerCase().includes(q)
      );
    });

    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "enrollmentNo":
          cmp = compareNatural(a.enrollmentNo, b.enrollmentNo);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "pageCount":
          cmp = (a.pageCount ?? -1) - (b.pageCount ?? -1);
          break;
        case "submittedAt":
          cmp =
            new Date(a.submittedAt ?? 0).getTime() - new Date(b.submittedAt ?? 0).getTime();
          break;
      }
      // Ties always fall back to enrollment order, the document's canonical order.
      if (cmp === 0) cmp = compareNatural(a.enrollmentNo, b.enrollmentNo);
      return asc ? cmp : -cmp;
    });

    return out;
  }, [rows, debounced, filter, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  async function copyPending() {
    const pending = rows.filter((r) => r.status !== "SUBMITTED");
    const text = pending.map((r) => `${r.enrollmentNo} — ${r.name}`).join("\n");
    await navigator.clipboard.writeText(text || "Everyone has submitted.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const counts = {
    all: rows.length,
    submitted: rows.filter((r) => r.status === "SUBMITTED").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, enrollment number, or filename"
            aria-label="Search submissions"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "submitted", "pending", "failed"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              )}
            >
              {f} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
          <Button variant="secondary" size="sm" onClick={copyPending}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy pending"}
          </Button>
        </div>
      </div>

      {/* Desktop table. The header sticks to the top of this scroll container
          rather than the page, so it never overlaps the first row. */}
      <div className="hidden max-h-[70vh] overflow-auto md:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="w-12 border-b border-slate-200 px-4 py-2.5 font-medium dark:border-slate-800">#</th>
              <Th onClick={() => toggleSort("enrollmentNo")} active={sortKey === "enrollmentNo"} asc={asc}>
                Enrollment No
              </Th>
              <Th onClick={() => toggleSort("name")} active={sortKey === "name"} asc={asc}>
                Name
              </Th>
              <Th onClick={() => toggleSort("status")} active={sortKey === "status"} asc={asc}>
                Status
              </Th>
              <th className="border-b border-slate-200 px-4 py-2.5 font-medium dark:border-slate-800">Filename</th>
              <Th onClick={() => toggleSort("pageCount")} active={sortKey === "pageCount"} asc={asc}>
                Pages
              </Th>
              <Th onClick={() => toggleSort("submittedAt")} active={sortKey === "submittedAt"} asc={asc}>
                Submitted
              </Th>
              <th className="border-b border-slate-200 px-4 py-2.5 text-right font-medium dark:border-slate-800">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={r.studentId}
                className="[&>td]:border-b [&>td]:border-slate-100 hover:bg-slate-50 dark:[&>td]:border-slate-800 dark:hover:bg-slate-900/60"
              >
                <td className="px-4 py-3 tabular-nums text-slate-400">{i + 1}</td>
                <td className="px-4 py-3 font-mono text-xs font-medium">{r.enrollmentNo}</td>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="max-w-[220px] px-4 py-3">
                  {r.filename ? (
                    <span className="block truncate font-mono text-xs text-slate-600 dark:text-slate-400" title={r.filename}>
                      {r.filename}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{r.pageCount ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {relativeTime(r.submittedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.webViewLink ? (
                    <a
                      href={r.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {visible.map((r) => (
          <li key={r.studentId} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium">{r.enrollmentNo}</p>
                <p className="mt-0.5 truncate text-sm">{r.name}</p>
                {r.filename ? (
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{r.filename}</p>
                ) : null}
              </div>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {r.pageCount ? `${r.pageCount} pages · ` : ""}
              {r.sizeBytes ? `${formatBytes(r.sizeBytes)} · ` : ""}
              {relativeTime(r.submittedAt)}
            </p>
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-slate-500">No students match this filter.</p>
      ) : null}
    </Card>
  );
}

function Th({
  children,
  onClick,
  active,
  asc,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  asc: boolean;
}) {
  return (
    <th className="border-b border-slate-200 px-4 py-2.5 font-medium dark:border-slate-800">
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-slate-900 dark:hover:text-white",
          active && "text-slate-900 dark:text-white"
        )}
        aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
      >
        {children}
        <ArrowUpDown className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: Row["status"] }) {
  if (status === "SUBMITTED")
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" /> Submitted
      </Badge>
    );
  if (status === "FAILED")
    return (
      <Badge tone="red">
        <AlertTriangle className="h-3 w-3" /> Failed
      </Badge>
    );
  return (
    <Badge tone="amber">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

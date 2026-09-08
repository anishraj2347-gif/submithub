"use client";

import * as React from "react";
import {
  UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2, ExternalLink, RefreshCw,
} from "lucide-react";
import { Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/filetypes";

type Existing = {
  storedFilename: string;
  pageCount: number;
  submittedAt: string;
  version: number;
  webViewLink: string | null;
} | null;

type Result = {
  storedFilename: string;
  pageCount: number;
  sizeBytes: number;
  submittedAt: string;
  webViewLink: string | null;
  version: number;
};

export function SubmitForm({
  assignmentId,
  studentName,
  enrollmentNo,
  existing,
}: {
  assignmentId: string;
  studentName: string;
  enrollmentNo: string;
  existing: Existing;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function pick(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    const ext = `.${next.name.split(".").pop()?.toLowerCase()}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setFile(null);
      return setError(`"${ext}" files aren't accepted. Use ${ACCEPTED_EXTENSIONS.join(", ")}.`);
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      return setError(`That file is ${formatBytes(next.size)} — the limit is 25 MB.`);
    }
    setFile(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.set("assignmentId", assignmentId);
    body.set("enrollmentNo", enrollmentNo);
    body.set("file", file);

    try {
      const res = await fetch("/api/submissions", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setResult(data.submission);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className="rounded-full bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Submission received</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your file was renamed and stored in the class Drive folder.
          </p>

          <dl className="mt-6 w-full max-w-sm space-y-2 text-left text-sm">
            <Row label="Stored as" value={<code className="text-xs">{result.storedFilename}</code>} />
            <Row label="Pages" value={result.pageCount} />
            <Row label="Size" value={formatBytes(result.sizeBytes)} />
            <Row label="Submitted" value={new Date(result.submittedAt).toLocaleString()} />
            <Row label="Version" value={`v${result.version}`} />
          </dl>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {result.webViewLink ? (
              <a href={result.webViewLink} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <ExternalLink className="h-4 w-4" /> View in Drive
                </Button>
              </a>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
            >
              <RefreshCw className="h-4 w-4" /> Replace this file
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit your assignment</CardTitle>
      </CardHeader>

      <form onSubmit={submit} className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input
              value={studentName}
              readOnly
              aria-readonly
              className="w-full cursor-default rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
            />
          </Field>
          <Field label="Enrollment number">
            <input
              value={enrollmentNo}
              readOnly
              aria-readonly
              className="w-full cursor-default rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
            />
          </Field>
        </div>
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
          Filled in from your account — these cannot be edited.
        </p>

        {existing ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              You already submitted <strong>{existing.storedFilename}</strong> (v{existing.version},{" "}
              {existing.pageCount} pages). Uploading again will replace it.
            </p>
          </div>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
            dragging
              ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10"
              : "border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600"
          }`}
        >
          {file ? (
            <>
              <FileText className="h-8 w-8 text-indigo-600" />
              <p className="mt-3 text-sm font-medium">{file.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(file.size)}</p>
            </>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium">Drop your file here, or click to browse</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PDF, DOCX, DOC, ODT or PPTX · up to 25 MB
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button type="submit" size="lg" disabled={!file || busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
              </>
            ) : existing ? (
              "Replace submission"
            ) : (
              "Submit assignment"
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 dark:border-slate-800">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

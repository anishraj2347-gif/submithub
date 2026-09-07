import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Natural sort key for enrollment numbers so that 21BCE9 sorts before 21BCE10.
 * Every run of digits is zero-padded to 10 chars; letters are upper-cased.
 * The result is a plain string, so Postgres can ORDER BY it directly.
 */
export function naturalKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/\d+/g, (digits) => digits.padStart(10, "0"));
}

export function compareNatural(a: string, b: string): number {
  const ka = naturalKey(a);
  const kb = naturalKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    // "C++" would otherwise collapse to "c"; keep it readable as "cpp".
    .replace(/\+/g, "p")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Strip anything that would be awkward in a Drive filename. */
export function safeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return safeSegment(parts.length > 1 ? parts[parts.length - 1] : parts[0]);
}

/** {enrollmentNo}_{lastName}_{assignmentSlug}.{ext} */
export function buildStoredFilename(
  enrollmentNo: string,
  studentName: string,
  assignmentSlug: string,
  ext: string
): string {
  const clean = ext.replace(/^\./, "").toLowerCase();
  return `${safeSegment(enrollmentNo)}_${lastName(studentName)}_${assignmentSlug}.${clean}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

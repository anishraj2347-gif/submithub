import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import {
  getDrive,
  ensureAssignmentTree,
  uploadOrReplaceFromFile,
  downloadFile,
} from "@/lib/drive";
import { compressDocumentImages } from "@/lib/compress";

export type MergeOptions = {
  coverPage: boolean;
  separators: boolean;
  pageNumbers: boolean;
  tableOfContents: boolean;
};

/**
 * Storage seam: production uses Google Drive, tests use an in-memory map.
 * Keeping this injectable lets the merge logic be exercised without network.
 */
export type MergeStorage = {
  fetchPdf: (driveFileId: string) => Promise<Buffer>;
  /** Receives a path to the finished PDF on disk, never the bytes themselves. */
  saveFinal: (
    name: string,
    file: { path: string; size: number }
  ) => Promise<{ id: string; webViewLink: string | null }>;
};

export type PageMapEntry = {
  enrollmentNo: string;
  name: string;
  startPage: number;
  endPage: number;
};

/**
 * A submission larger than this is assumed to predate upload-time compression
 * and is put through the image pass on the way in. Roughly ten times what a
 * compressed submission of a few dozen pages comes to.
 */
const COMPRESS_THRESHOLD = 5 * 1024 * 1024;

/**
 * A merge takes a couple of minutes. One still unfinished after this long has
 * lost its worker — the process was restarted or killed — and nothing will
 * ever update its row. Such a job must not go on blocking new merges, so both
 * the dashboard and the merge endpoint ignore it.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export function staleJobCutoff(): Date {
  return new Date(Date.now() - STALE_AFTER_MS);
}

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.31, 0.27, 0.9);

async function driveStorage(course: string, title: string): Promise<MergeStorage> {
  const drive = await getDrive();
  const tree = await ensureAssignmentTree(drive, course, title);
  return {
    fetchPdf: (fileId) => downloadFile(drive, fileId),
    saveFinal: (name, file) =>
      uploadOrReplaceFromFile(drive, {
        name,
        parentId: tree.final,
        mimeType: "application/pdf",
        path: file.path,
      }),
  };
}

/**
 * Thrown when the CR stopped the job mid-flight. It unwinds the same way a
 * real failure does, but the catch block records it as CANCELLED rather than
 * burying "we changed our mind" in the failure log.
 */
class MergeCancelled extends Error {
  constructor() {
    super("Merge cancelled");
    this.name = "MergeCancelled";
  }
}

/**
 * The only cancellation channel we have: the job runs in-process with no
 * handle to abort it, so it re-reads its own row at each checkpoint and
 * unwinds itself when the status has been flipped underneath it.
 */
/**
 * Serialises the document to a file. Kept separate so the byte array it
 * produces is unreachable the moment it returns, rather than staying live for
 * the length of the upload.
 */
async function writeToDisk(doc: PDFDocument, path: string): Promise<number> {
  const bytes = await doc.save();
  await writeFile(path, bytes);
  return bytes.length;
}

async function setStep(jobId: string, step: string, progress: number) {
  const row = await prisma.mergeJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!row || row.status === "CANCELLED") throw new MergeCancelled();
  await prisma.mergeJob.update({ where: { id: jobId }, data: { step, progress } });
}

function drawCentered(page: ReturnType<PDFDocument["addPage"]>, text: string, font: PDFFont, size: number, y: number, color = INK) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (A4[0] - width) / 2, y, size, font, color });
}

/**
 * Runs the whole merge for one job. Any single bad file fails the entire job
 * with the offending enrollment number named, rather than silently producing
 * a partial document.
 */
export async function runMergeJob(jobId: string, storage?: MergeStorage): Promise<void> {
  const job = await prisma.mergeJob.findUnique({
    where: { id: jobId },
    include: { assignment: true },
  });
  if (!job) throw new Error(`Merge job ${jobId} not found`);

  const options = ((job.pageMap as { options?: MergeOptions } | null)?.options ?? {
    coverPage: true,
    separators: true,
    pageNumbers: true,
    tableOfContents: true,
  }) as MergeOptions;

  try {
    await prisma.mergeJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", step: "FETCHING", progress: 5 },
    });

    const submissions = await prisma.submission.findMany({
      where: { id: { in: job.includedSubmissions } },
      include: { student: true },
    });
    if (submissions.length === 0) throw new Error("No submissions were selected for this merge.");

    // Preserve the exact order the CR confirmed on the verification screen.
    const order = new Map(job.includedSubmissions.map((id, i) => [id, i]));
    submissions.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const store = storage ?? (await driveStorage(job.assignment.course, job.assignment.title));
    const out = await PDFDocument.create();
    const helv = await out.embedFont(StandardFonts.Helvetica);
    const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

    if (options.coverPage) {
      const cover = out.addPage(A4);
      drawCentered(cover, job.assignment.course, helv, 12, 600, MUTED);
      drawCentered(cover, job.assignment.title, helvBold, 26, 560);
      cover.drawLine({
        start: { x: 160, y: 540 },
        end: { x: A4[0] - 160, y: 540 },
        thickness: 2,
        color: ACCENT,
      });
      drawCentered(cover, `Compiled submissions — ${submissions.length} students`, helv, 13, 505, MUTED);
      drawCentered(
        cover,
        new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
        helv,
        11,
        482,
        MUTED
      );
      drawCentered(cover, "Generated by SubmitHub", helv, 9, 60, MUTED);
    }

    // The TOC is written after the merge (page numbers aren't known yet), so
    // reserve its pages now and keep references to fill in later.
    const tocPageCount = options.tableOfContents ? Math.max(1, Math.ceil(submissions.length / 30)) : 0;
    const tocPages = [];
    for (let i = 0; i < tocPageCount; i++) tocPages.push(out.addPage(A4));

    await setStep(jobId, "MERGING", 20);

    const pageMap: PageMapEntry[] = [];
    let imageBytesBefore = 0;
    let imageBytesAfter = 0;

    for (let i = 0; i < submissions.length; i++) {
      // Checkpoint first: this both reports progress and gives the CR a place
      // to stop the job before we spend time on another Drive download.
      await setStep(jobId, "MERGING", 20 + Math.round((i / submissions.length) * 55));

      const sub = submissions[i];
      const label = `${sub.student.enrollmentNo} (${sub.student.name})`;

      if (!sub.pdfDriveFileId) {
        throw new Error(`${label} has no converted PDF. Exclude them or ask for a resubmission.`);
      }

      let bytes: Buffer;
      try {
        bytes = await store.fetchPdf(sub.pdfDriveFileId);
      } catch {
        throw new Error(`Could not download the file for ${label} from Google Drive.`);
      }

      if (options.separators) {
        // Mirrors the header students use inside their own documents:
        //   DEV PRAKASH THAKUR
        //   A45304925011   B.Sc. (IT) III
        const sep = out.addPage(A4);
        drawCentered(sep, sub.student.name.toUpperCase(), helvBold, 20, 474);
        const programme = job.assignment.programme?.trim();
        drawCentered(
          sep,
          programme
            ? `${sub.student.enrollmentNo}   ${programme}`
            : sub.student.enrollmentNo,
          helvBold,
          14,
          446,
          ACCENT
        );
      }

      const startPage = out.getPageCount() + 1;

      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (src.isEncrypted) {
          throw new Error(`${label} submitted a password-protected PDF. Exclude them or ask for an unlocked copy.`);
        }
        // Submissions are compressed as they are uploaded, so this is only a
        // safety net for anything stored before that. Decoding every image of
        // an already-small file costs real memory for nothing, so only files
        // that are still heavy are put through it.
        if (bytes.length > COMPRESS_THRESHOLD) {
          const shrunk = await compressDocumentImages(src);
          imageBytesBefore += shrunk.bytesBefore;
          imageBytesAfter += shrunk.bytesAfter;
        }

        const copied = await out.copyPages(src, src.getPageIndices());
        if (copied.length === 0) throw new Error(`${label} submitted a PDF with no pages.`);
        copied.forEach((p) => out.addPage(p));
      } catch (err) {
        if (err instanceof Error && err.message.startsWith(sub.student.enrollmentNo)) throw err;
        throw new Error(`The PDF for ${label} could not be read and the merge was stopped.`);
      }

      pageMap.push({
        enrollmentNo: sub.student.enrollmentNo,
        name: sub.student.name,
        startPage,
        endPage: out.getPageCount(),
      });
    }

    if (options.tableOfContents && tocPages.length > 0) {
      let page = tocPages[0];
      let index = 0;
      let y = 780;
      page.drawText("Contents", { x: 60, y, size: 20, font: helvBold, color: INK });
      y -= 34;
      for (const entry of pageMap) {
        if (y < 60) {
          index += 1;
          if (index >= tocPages.length) break;
          page = tocPages[index];
          y = 790;
        }
        const left = `${entry.enrollmentNo}  ${entry.name}`;
        const right = String(entry.startPage);
        page.drawText(left, { x: 60, y, size: 10, font: helv, color: INK });
        const rw = helv.widthOfTextAtSize(right, 10);
        page.drawText(right, { x: A4[0] - 60 - rw, y, size: 10, font: helv, color: MUTED });
        y -= 20;
      }
    }

    if (options.pageNumbers) {
      const pages = out.getPages();
      pages.forEach((p, i) => {
        const text = `${i + 1} / ${pages.length}`;
        const w = helv.widthOfTextAtSize(text, 9);
        p.drawText(text, { x: (A4[0] - w) / 2, y: 24, size: 9, font: helv, color: MUTED });
      });
    }

    await setStep(jobId, "SAVING", 85);

    // Everything below is the memory peak of a merge: the whole page graph is
    // still live while the serialised document is produced. Writing straight
    // to disk avoids the extra full-size copy that Buffer.from() would make,
    // and the upload then streams from the file rather than from memory.
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `Final_${job.assignment.slug}_${stamp}_v${job.version}.pdf`;
    const tmpPath = join(tmpdir(), `submithub-${jobId}.pdf`);

    const totalPages = out.getPageCount();
    const written = await writeToDisk(out, tmpPath);
    await setStep(jobId, "UPLOADING", 92);

    let uploadedFile: { id: string; webViewLink: string | null };
    try {
      uploadedFile = await store.saveFinal(filename, { path: tmpPath, size: written });
    } finally {
      // The instance's disk is small and shared; never leave a copy behind.
      await rm(tmpPath, { force: true }).catch(() => {});
    }

    // A cancel can land while the upload is in flight. Don't let the success
    // write resurrect the job — the CR asked for it to stop, and the orphaned
    // Drive file is harmless (it is only reachable from a job row).
    const finished = await prisma.mergeJob.updateMany({
      where: { id: jobId, status: { not: "CANCELLED" } },
      data: {
        status: "SUCCESS",
        step: "DONE",
        progress: 100,
        totalPages,
        outputDriveFileId: uploadedFile.id,
        outputUrl: uploadedFile.webViewLink,
        outputFilename: filename,
        pageMap: {
          options,
          entries: pageMap,
          images: { bytesBefore: imageBytesBefore, bytesAfter: imageBytesAfter },
        },
        finishedAt: new Date(),
      },
    });
    if (finished.count === 0) return;

    // A merge does not close submissions while the deadline is still ahead —
    // the CR can merge early to preview the packet, and latecomers keep their
    // window. The due date is enforced independently in the submissions API,
    // so only mark the assignment MERGED once that window has actually shut.
    const deadlinePassed = job.assignment.dueAt
      ? job.assignment.dueAt.getTime() < Date.now()
      : true;
    if (deadlinePassed) {
      await prisma.assignment.update({
        where: { id: job.assignmentId },
        data: { status: "MERGED" },
      });
    }
  } catch (err) {
    if (err instanceof MergeCancelled) {
      // The status was already set by whoever cancelled; only close out the
      // run. No partial PDF is uploaded, so there is nothing to clean up.
      await prisma.mergeJob.update({
        where: { id: jobId },
        data: { step: "CANCELLED", finishedAt: new Date() },
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Merge failed";
    console.error("[merge]", err);
    await prisma.mergeJob.update({
      where: { id: jobId },
      data: { status: "FAILED", step: "FAILED", error: message, finishedAt: new Date() },
    });
  }
}

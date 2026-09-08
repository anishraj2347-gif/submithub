import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GDOC_MIME = "application/vnd.google-apps.document";
const GSLIDES_MIME = "application/vnd.google-apps.presentation";

export class DriveNotConnectedError extends Error {
  constructor() {
    super("Google Drive is not connected. A CR must connect Drive in Settings.");
    this.name = "DriveNotConnectedError";
  }
}

export function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? `${process.env.AUTH_URL ?? "http://localhost:3000"}/api/drive/callback`
  );
}

/**
 * All Drive traffic goes through the single connected CR account, so every
 * submission lands in one folder tree the CR actually owns.
 *
 * The raw OAuth client comes back too, because exporting a document larger
 * than 10 MB needs a plain authorized fetch rather than the Drive client.
 */
export async function getDriveContext(): Promise<{ drive: drive_v3.Drive; auth: OAuth2Client }> {
  const cred = await prisma.driveCredential.findUnique({ where: { id: "singleton" } });
  if (!cred) throw new DriveNotConnectedError();
  const client = oauthClient();
  client.setCredentials({ refresh_token: cred.refreshToken });
  return { drive: google.drive({ version: "v3", auth: client }), auth: client };
}

export async function getDrive(): Promise<drive_v3.Drive> {
  return (await getDriveContext()).drive;
}

export async function isDriveConnected(): Promise<boolean> {
  const cred = await prisma.driveCredential.findUnique({ where: { id: "singleton" } });
  return Boolean(cred);
}

/** Create-or-find, so repeated submissions never duplicate the folder tree. */
export async function ensureFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const clauses = [
    `name = '${escaped}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ];
  const found = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id, name)",
    pageSize: 1,
  });
  const hit = found.data.files?.[0]?.id;
  if (hit) return hit;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Failed to create Drive folder "${name}"`);
  return created.data.id;
}

/** /SubmitHub/{course}/{assignment}/{submissions,normalized,final} */
export async function ensureAssignmentTree(
  drive: drive_v3.Drive,
  course: string,
  assignmentTitle: string
) {
  const cred = await prisma.driveCredential.findUnique({ where: { id: "singleton" } });
  const configuredRoot = process.env.DRIVE_ROOT_FOLDER_ID?.trim() || cred?.rootFolderId || undefined;

  const root = configuredRoot ?? (await ensureFolder(drive, "SubmitHub"));
  // A blank course keeps the tree flat: SubmitHub/<assignment>/...
  const courseId = course.trim() ? await ensureFolder(drive, course.trim(), root) : root;
  const assignmentId = await ensureFolder(drive, assignmentTitle, courseId);
  const submissions = await ensureFolder(drive, "submissions", assignmentId);
  const normalized = await ensureFolder(drive, "normalized", assignmentId);
  const final = await ensureFolder(drive, "final", assignmentId);
  return { root, courseId, assignmentId, submissions, normalized, final };
}

async function findByNameInFolder(drive: drive_v3.Drive, name: string, parentId: string) {
  const escaped = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name = '${escaped}' and '${parentId}' in parents and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

/** Upload, replacing any existing file of the same name (resubmission). */
export async function uploadOrReplace(
  drive: drive_v3.Drive,
  opts: { name: string; parentId: string; mimeType: string; body: Buffer; convertTo?: string }
): Promise<{ id: string; webViewLink: string | null }> {
  const existing = await findByNameInFolder(drive, opts.name, opts.parentId);
  const media = { mimeType: opts.mimeType, body: Readable.from(opts.body) };

  if (existing) {
    const updated = await drive.files.update({
      fileId: existing,
      media,
      fields: "id, webViewLink",
    });
    return { id: updated.data.id!, webViewLink: updated.data.webViewLink ?? null };
  }

  const created = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.parentId],
      mimeType: opts.convertTo ?? undefined,
    },
    media,
    fields: "id, webViewLink",
  });
  return { id: created.data.id!, webViewLink: created.data.webViewLink ?? null };
}

/**
 * Convert an Office/ODF file to PDF using Drive's own converter.
 * This is why the app needs no LibreOffice binary and runs on serverless.
 */
export async function convertToPdf(
  drive: drive_v3.Drive,
  opts: {
    name: string;
    mimeType: string;
    body: Buffer;
    isPresentation: boolean;
    auth?: OAuth2Client;
  }
): Promise<Buffer> {
  const temp = await drive.files.create({
    requestBody: {
      name: `__convert__${opts.name}`,
      mimeType: opts.isPresentation ? GSLIDES_MIME : GDOC_MIME,
    },
    media: { mimeType: opts.mimeType, body: Readable.from(opts.body) },
    fields: "id",
  });
  const tempId = temp.data.id!;

  try {
    try {
      const exported = await drive.files.export(
        { fileId: tempId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" }
      );
      return Buffer.from(exported.data as ArrayBuffer);
    } catch (err) {
      // files.export is capped at 10 MB and answers 403 above it. Google's
      // documented route for larger documents is the exportLinks URL, fetched
      // with the same credentials.
      const status = (err as { code?: number; status?: number })?.code ??
        (err as { status?: number })?.status;
      if (status !== 403 || !opts.auth) throw err;

      const meta = await drive.files.get({ fileId: tempId, fields: "exportLinks" });
      const link = (meta.data.exportLinks as Record<string, string> | undefined)?.[
        "application/pdf"
      ];
      if (!link) throw err;

      const token = (await opts.auth.getAccessToken()).token;
      if (!token) throw err;

      const res = await fetch(link, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new Error(
          `Google could not export this document to PDF (${res.status}). ` +
            "It may be too large or too complex to convert."
        );
      }
      return Buffer.from(await res.arrayBuffer());
    }
  } finally {
    await drive.files.delete({ fileId: tempId }).catch(() => {});
  }
}

export async function downloadFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/**
 * Streaming counterpart to downloadFile, for handing a file straight to the
 * browser. A merged class document runs to tens or hundreds of megabytes, and
 * buffering one whole is enough to exhaust a small instance — so the bytes are
 * never held in memory all at once.
 *
 * The size comes back too, so the response can carry Content-Length and the
 * browser can show a real progress bar rather than an open-ended spinner.
 */
export async function downloadFileStream(
  drive: drive_v3.Drive,
  fileId: string
): Promise<{ stream: Readable; size: number | null }> {
  const meta = await drive.files.get({ fileId, fields: "size" });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  const size = meta.data.size ? Number(meta.data.size) : null;
  return { stream: res.data as unknown as Readable, size: Number.isFinite(size) ? size : null };
}

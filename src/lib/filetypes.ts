export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export type AcceptedKind = "pdf" | "docx" | "doc" | "odt" | "pptx";

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".odt", ".pptx"];

const MIME_BY_KIND: Record<AcceptedKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Sniff the real file type from magic bytes rather than trusting the extension.
 * ZIP-based Office formats (docx/pptx/odt) all start with "PK", so we
 * disambiguate them by looking for their marker entries in the archive bytes.
 */
export function sniffKind(buf: Buffer, filename: string): AcceptedKind | null {
  if (buf.length < 4) return null;

  // %PDF
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";

  // OLE2 compound file (legacy .doc)
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(ole)) return "doc";

  // ZIP container
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    // ODF stores its mimetype as the first (stored, uncompressed) entry.
    const head = buf.subarray(0, 200).toString("latin1");
    if (head.includes("mimetypeapplication/vnd.oasis.opendocument.text")) {
      return "odt";
    }
    // OOXML: scan for the part names that identify the document body.
    const text = buf.toString("latin1");
    if (text.includes("word/document.xml")) return "docx";
    if (text.includes("ppt/presentation.xml")) return "pptx";

    // Fall back to the extension, but only within the ZIP-based family.
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "docx" || ext === "pptx" || ext === "odt") return ext;
  }

  return null;
}

export function mimeForKind(kind: AcceptedKind): string {
  return MIME_BY_KIND[kind];
}

export function isPdf(kind: AcceptedKind): boolean {
  return kind === "pdf";
}

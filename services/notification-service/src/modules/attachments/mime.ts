/**
 * CH-19 — Server-side MIME type validation via magic bytes.
 *
 * Checks the first N bytes of a file buffer to determine its true MIME type,
 * rejecting files whose actual content doesn't match allowed types.
 */

interface MagicSignature {
  mime: string;
  bytes: number[];
  offset?: number;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  // MS Office (DOCX/XLSX are ZIP-based)
  { mime: "application/zip", bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK..
  // Legacy MS Office (DOC/XLS)
  { mime: "application/msoffice", bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
];

/** MIME types we allow for upload. */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4",
  "audio/mpeg",
  "text/plain",
  "text/csv",
]);

/**
 * Extension-based allowed set for text files that have no distinguishing magic bytes.
 */
const TEXT_EXTENSIONS = new Set([".txt", ".csv"]);

/**
 * Detect MIME type from file buffer magic bytes.
 * Returns the detected MIME type or null if unrecognized.
 */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buffer[offset + i] === b);
    if (matches) return sig.mime;
  }
  return null;
}

/**
 * Validate that a file's content matches an allowed MIME type.
 * Uses magic bytes for binary files, extension for text files.
 */
export function validateMime(buffer: Buffer, filename: string, declaredMime: string): { valid: boolean; detectedMime: string } {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();

  // Text/CSV files have no distinctive magic bytes; trust declared MIME + extension
  if (TEXT_EXTENSIONS.has(ext) && (declaredMime === "text/plain" || declaredMime === "text/csv")) {
    return { valid: true, detectedMime: declaredMime };
  }

  const detected = detectMimeFromBuffer(buffer);
  if (!detected) {
    return { valid: false, detectedMime: declaredMime };
  }

  // ZIP-based Office formats: magic bytes show as application/zip but the file is docx/xlsx
  if (detected === "application/zip") {
    const officeZipMimes = new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    if (officeZipMimes.has(declaredMime)) {
      return { valid: true, detectedMime: declaredMime };
    }
  }

  // Legacy Office magic → allow DOC/XLS declared types
  if (detected === "application/msoffice") {
    const legacyOfficeMimes = new Set(["application/msword", "application/vnd.ms-excel"]);
    if (legacyOfficeMimes.has(declaredMime)) {
      return { valid: true, detectedMime: declaredMime };
    }
  }

  // Direct match
  if (ALLOWED_MIME_TYPES.has(detected)) {
    return { valid: true, detectedMime: detected };
  }

  return { valid: false, detectedMime: detected };
}

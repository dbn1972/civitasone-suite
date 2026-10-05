/**
 * Content sniffing for bulk-scan uploads. Trust bytes, never the declared mime type or file extension.
 * Accepts PDF, TIFF, JPEG, PNG only. Everything else is rejected with a machine-readable reason code.
 */
import type { AllowedMime } from "./validators.js";

export const REJECT_REASONS = [
  "EMPTY_FILE", "EXECUTABLE_CONTENT", "SVG_NOT_ALLOWED", "UNSUPPORTED_FILE_TYPE", "ENCRYPTED_PDF", "MIME_MISMATCH",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type SniffResult =
  | { ok: true; mime: AllowedMime }
  | { ok: false; reason: RejectReason };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

function asciiHead(b: Uint8Array, n: number): string {
  let s = "";
  for (let i = 0; i < Math.min(b.length, n); i++) s += String.fromCharCode(b[i] as number);
  return s;
}

/** Executable / script containers we refuse even if renamed .pdf. */
function isExecutable(b: Uint8Array): boolean {
  if (startsWith(b, [0x4d, 0x5a])) return true;                       // MZ  (PE / DOS)
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return true;           // ELF
  if (startsWith(b, [0x23, 0x21])) return true;                       // #!  shebang
  const macho = [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]];
  return macho.some((sig) => startsWith(b, sig));                     // Mach-O / fat (also Java class)
}

function isSvgOrMarkup(b: Uint8Array): boolean {
  // Skip a UTF-8 BOM and leading whitespace, then look at the first tag.
  const head = asciiHead(b, 512).replace(/^ï»¿/, "").trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg") || head.startsWith("<html") || head.startsWith("<!doctype html");
}

/** PDF header may be preceded by a little junk (spec allows the first 1024 bytes). */
function pdfHeaderOffset(b: Uint8Array): number {
  const head = asciiHead(b, 1024);
  return head.indexOf("%PDF-");
}

/**
 * Encrypted PDFs carry an /Encrypt entry in the trailer (or xref-stream dictionary). We search the whole
 * buffer for the name token, which can also match a document that merely mentions "/Encrypt" in text
 * - we err on the side of rejecting (the reviewer can re-upload a decrypted copy).
 */
export function isEncryptedPdf(b: Uint8Array): boolean {
  const s = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
  return /\/Encrypt(?![A-Za-z0-9])/.test(s);
}

export function detectMime(b: Uint8Array): AllowedMime | null {
  if (pdfHeaderOffset(b) >= 0) return "application/pdf";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])
    || startsWith(b, [0x49, 0x49, 0x2b, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2b])) return "image/tiff";
  return null;
}

/**
 * Validate the full content of an uploaded object. `declaredMime` (from the presign request) must match the
 * detected type, so a PNG cannot be submitted as a PDF to slip past a type allow-list.
 */
export function sniffUpload(bytes: Uint8Array, declaredMime?: string | null): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: "EMPTY_FILE" };
  if (isExecutable(bytes)) return { ok: false, reason: "EXECUTABLE_CONTENT" };
  if (isSvgOrMarkup(bytes)) return { ok: false, reason: "SVG_NOT_ALLOWED" };
  const mime = detectMime(bytes);
  if (!mime) return { ok: false, reason: "UNSUPPORTED_FILE_TYPE" };
  if (mime === "application/pdf" && isEncryptedPdf(bytes)) return { ok: false, reason: "ENCRYPTED_PDF" };
  if (declaredMime && declaredMime !== mime) return { ok: false, reason: "MIME_MISMATCH" };
  return { ok: true, mime };
}

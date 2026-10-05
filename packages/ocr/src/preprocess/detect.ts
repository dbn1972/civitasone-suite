import { OcrInputError } from "../errors.js";

export type InputKind = "pdf" | "png" | "jpeg" | "tiff";

export const MIME_FOR_KIND: Record<InputKind, "application/pdf" | "image/png" | "image/jpeg" | "image/tiff"> = {
  pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", tiff: "image/tiff",
};

const startsWith = (d: Uint8Array, sig: number[], at = 0): boolean => sig.every((b, i) => d[at + i] === b);

/** Detects the real file type from magic bytes (the claimed MIME type / extension is never trusted). */
export function detectInputKind(data: Uint8Array): InputKind {
  if (data.length < 8) throw new OcrInputError("CORRUPT", "File is empty or too short to identify");
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(data, [0x49, 0x49, 0x2a, 0x00]) || startsWith(data, [0x4d, 0x4d, 0x00, 0x2a])
    || startsWith(data, [0x49, 0x49, 0x2b, 0x00]) || startsWith(data, [0x4d, 0x4d, 0x00, 0x2b])) return "tiff";
  // PDF header may be preceded by up to 1024 bytes of junk (ISO 32000 / Acrobat behaviour).
  const head = Buffer.from(data.subarray(0, Math.min(1032, data.length)));
  if (head.indexOf("%PDF-") >= 0) return "pdf";
  throw new OcrInputError("UNSUPPORTED_TYPE", "Unsupported file type: only PDF, TIFF, JPEG and PNG are accepted (detected from file contents)");
}

/**
 * Cheap byte scan: true if the literal "/Encrypt" appears ANYWHERE in the file. This is only a pre-filter
 * / hint, NOT a verdict: the token can legitimately occur inside a stream, string or comment of an
 * unencrypted PDF. PdfSource.open decides via pdfjs (PasswordException); see pdfEncryptInTrailer.
 */
export function pdfLooksEncrypted(data: Uint8Array): boolean {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).indexOf("/Encrypt") >= 0;
}

/**
 * True if an /Encrypt entry is in the trailer dictionary: the text after the last `trailer` keyword, or - for
 * cross-reference-stream files - the dictionary around the last `/XRef` marker. Used ONLY as a fallback when
 * pdfjs cannot parse the file, so a stray "/Encrypt" in junk or in a stream never decides the outcome.
 */
export function pdfEncryptInTrailer(data: Uint8Array): boolean {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const t = buf.lastIndexOf("trailer");
  if (t >= 0) return buf.subarray(t).indexOf("/Encrypt") >= 0;
  const x = buf.lastIndexOf("/XRef");
  if (x < 0) return false;
  return buf.subarray(Math.max(0, x - 512), x + 2048).indexOf("/Encrypt") >= 0;
}

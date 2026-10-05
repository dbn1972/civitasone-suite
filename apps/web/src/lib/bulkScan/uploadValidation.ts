/**
 * Client-side pre-validation for bulk uploads: size / count / batch-size limits and magic bytes (PDF, TIFF, JPEG, PNG).
 * Mirrors document-service magic.ts + limits.ts so the operator hears about a bad file before uploading it. It is a
 * convenience only: the server re-checks everything (HEAD, sniff, sha256) on files/complete and is the authority.
 */
export const ALLOWED_UPLOAD_MIME = ["application/pdf", "image/tiff", "image/jpeg", "image/png"] as const;
export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME)[number];

export const HEAD_BYTES = 1024;
export const TAIL_BYTES = 16384;

export interface UploadLimits {
  maxFileBytes: number;
  maxFilesPerBatch: number;
  maxBatchBytes: number;
}

export const DEFAULT_LIMITS: UploadLimits = { maxFileBytes: 50 * 1024 * 1024, maxFilesPerBatch: 500, maxBatchBytes: 5 * 1024 * 1024 * 1024 };

export type RejectReason =
  | "EMPTY_FILE" | "EXECUTABLE_CONTENT" | "SVG_NOT_ALLOWED" | "UNSUPPORTED_FILE_TYPE" | "ENCRYPTED_PDF"
  | "FILE_TOO_LARGE" | "TOO_MANY_FILES" | "BATCH_TOO_LARGE" | "UNREADABLE";

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

function ascii(b: Uint8Array, n: number): string {
  let s = "";
  for (let i = 0; i < Math.min(b.length, n); i++) s += String.fromCharCode(b[i] as number);
  return s;
}

function isExecutable(b: Uint8Array): boolean {
  if (startsWith(b, [0x4d, 0x5a]) || startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(b, [0x23, 0x21])) return true; // MZ, ELF, #!
  return [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => startsWith(b, s));
}

function isMarkup(b: Uint8Array): boolean {
  const head = ascii(b, 512).replace(/^ï»¿/, "").trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg") || head.startsWith("<html") || head.startsWith("<!doctype html");
}

export function detectMime(head: Uint8Array): AllowedMime | null {
  if (ascii(head, 1024).indexOf("%PDF-") >= 0) return "application/pdf";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if ([[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a], [0x49, 0x49, 0x2b, 0x00], [0x4d, 0x4d, 0x00, 0x2b]].some((s) => startsWith(head, s))) return "image/tiff";
  return null;
}

/** Best-effort: the /Encrypt name lives in the trailer, so the tail of the file is enough for the common case. */
export function looksEncryptedPdf(tail: Uint8Array): boolean {
  return /\/Encrypt(?![A-Za-z0-9])/.test(ascii(tail, tail.length));
}

export type SniffResult = { ok: true; mime: AllowedMime } | { ok: false; reason: RejectReason };

export function sniffUpload(head: Uint8Array, tail: Uint8Array | null, sizeBytes: number): SniffResult {
  if (sizeBytes === 0 || head.length === 0) return { ok: false, reason: "EMPTY_FILE" };
  if (isExecutable(head)) return { ok: false, reason: "EXECUTABLE_CONTENT" };
  if (isMarkup(head)) return { ok: false, reason: "SVG_NOT_ALLOWED" };
  const mime = detectMime(head);
  if (!mime) return { ok: false, reason: "UNSUPPORTED_FILE_TYPE" };
  if (mime === "application/pdf" && looksEncryptedPdf(tail ?? head)) return { ok: false, reason: "ENCRYPTED_PDF" };
  return { ok: true, mime };
}

export interface Candidate {
  /** stable id (path + size) */
  key: string;
  name: string;
  relPath: string;
  size: number;
  mime: AllowedMime | null;
  reject: RejectReason | null;
  /** SHA-256 (hex) of the content, computed in the browser on resume so a re-selected file is matched to its server row by content. */
  sha256?: string | null;
}

/** Files above this size are not hashed in the browser (resume then falls back to name + size). */
export const HASH_MAX_BYTES = 100 * 1024 * 1024;

/** SHA-256 hex of a Blob via WebCrypto, or null when unavailable / too large / unreadable. */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (blob.size > HASH_MAX_BYTES) return null;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = new Uint8Array(await subtle.digest("SHA-256", (await readBytes(blob)) as unknown as BufferSource));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Adds `sha256` to every valid candidate (a few at a time, so a big folder does not hold many files in memory at once). */
export async function attachHashes(cands: readonly Candidate[], files: ReadonlyMap<string, Blob>, concurrency = 2): Promise<Candidate[]> {
  const out = [...cands];
  const todo = out.map((c, i) => ({ c, i })).filter(({ c }) => !c.reject && files.has(c.key));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const { c, i } = todo[next++]!;
      out[i] = { ...c, sha256: await sha256Hex(files.get(c.key)!) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return out;
}

/** Per-file limit check (size). Returns the reject reason or null. */
export function checkFileSize(size: number, limits: UploadLimits): RejectReason | null {
  if (size === 0) return "EMPTY_FILE";
  return size > limits.maxFileBytes ? "FILE_TOO_LARGE" : null;
}

/**
 * Apply the batch-level caps in order: once the count or the byte total would be exceeded, the file (and later ones that
 * would still not fit) is rejected with TOO_MANY_FILES / BATCH_TOO_LARGE. Already-rejected candidates are left alone.
 * `existing` is what the batch already holds on the server.
 */
export function applyBatchLimits(candidates: readonly Candidate[], existing: { fileCount: number; totalBytes: number }, limits: UploadLimits): Candidate[] {
  let count = existing.fileCount;
  let bytes = existing.totalBytes;
  return candidates.map((c) => {
    if (c.reject) return c;
    if (count + 1 > limits.maxFilesPerBatch) return { ...c, reject: "TOO_MANY_FILES" as const };
    if (bytes + c.size > limits.maxBatchBytes) return { ...c, reject: "BATCH_TOO_LARGE" as const };
    count += 1;
    bytes += c.size;
    return c;
  });
}

/** Read a slice of a Blob as bytes (works in browsers and jsdom). */
export async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsArrayBuffer(blob);
  });
}

/** Validate one File: size, then magic bytes of the head (and the tail of a PDF). */
export async function validateFile(file: Blob & { name: string }, relPath: string, limits: UploadLimits): Promise<Candidate> {
  const base = { key: `${relPath}|${file.size}`, name: file.name, relPath, size: file.size };
  const sizeReject = checkFileSize(file.size, limits);
  if (sizeReject) return { ...base, mime: null, reject: sizeReject };
  try {
    const head = await readBytes(file.slice(0, HEAD_BYTES));
    const tail = file.size > TAIL_BYTES ? await readBytes(file.slice(file.size - TAIL_BYTES)) : null;
    const r = sniffUpload(head, tail, file.size);
    return r.ok ? { ...base, mime: r.mime, reject: null } : { ...base, mime: null, reject: r.reason };
  } catch {
    return { ...base, mime: null, reject: "UNREADABLE" };
  }
}

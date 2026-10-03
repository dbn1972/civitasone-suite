/**
 * Public careers resume upload -- pure validation (GAP-RECRUITMENT-CAREERS-DETAIL-04).
 *
 * The upload endpoint is unauthenticated, so everything is checked server-side and none of it
 * trusts the browser: the declared MIME type must be allowed AND match the file extension AND
 * match the file's own magic bytes (a renamed .exe is rejected), and the real decoded size is
 * measured (not the declared one).
 */
import { MAX_RESUME_BYTES } from "./resume-domain.js";

export const PUBLIC_RESUME_TYPES: Record<string, { ext: string; magic: number[][] }> = {
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] }, // %PDF-
  "application/msword": { ext: "doc", magic: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] }, // OLE2 compound file
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", magic: [[0x50, 0x4b, 0x03, 0x04]] }, // zip
};

/** Object-store namespace of one tenant's public resumes. */
export function publicResumePrefix(tenantId: string): string {
  return `careers-resumes/${tenantId}/`;
}

/** A key this module generated: `careers-resumes/<tenant>/<uuid>.<ext>`. */
export function isPublicResumeKey(key: string, tenantId: string): boolean {
  const prefix = publicResumePrefix(tenantId);
  if (!key.startsWith(prefix)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|doc|docx)$/i.test(key.slice(prefix.length));
}

export interface PublicResumeInput { fileName: string; mimeType: string; bytes: Buffer }

/** Human-readable errors (empty = acceptable). */
export function validatePublicResume(i: PublicResumeInput): string[] {
  const errors: string[] = [];
  const spec = PUBLIC_RESUME_TYPES[i.mimeType];
  if (!spec) {
    errors.push(`unsupported file type '${i.mimeType}' (allowed: PDF, DOC, DOCX)`);
    return errors;
  }
  const name = (i.fileName ?? "").trim().toLowerCase();
  if (!name.endsWith(`.${spec.ext}`)) errors.push(`the file name must end in .${spec.ext}`);
  if (i.bytes.length === 0) errors.push("the file is empty");
  else if (i.bytes.length > MAX_RESUME_BYTES) errors.push(`the file exceeds the ${Math.floor(MAX_RESUME_BYTES / (1024 * 1024))} MB limit`);
  else if (!spec.magic.some((m) => m.every((b, idx) => i.bytes[idx] === b))) errors.push("the file content does not match its declared type");
  return errors;
}

/**
 * Malware-scan outcome policy. In production an unavailable scanner REJECTS the upload (a public,
 * unauthenticated write must not skip scanning); outside production, or when the operator sets
 * CAREERS_RESUME_SCAN_OPTIONAL=true, an unavailable scanner is tolerated. An infected file is
 * always rejected.
 */
export function scanVerdict(status: "clean" | "infected" | "error", env: Record<string, string | undefined> = process.env): "accept" | "infected" | "unavailable" {
  if (status === "clean") return "accept";
  if (status === "infected") return "infected";
  const optional = env.NODE_ENV !== "production" || env.CAREERS_RESUME_SCAN_OPTIONAL === "true";
  return optional ? "accept" : "unavailable";
}

/**
 * Peers whose X-Forwarded-For we believe: loopback and private ranges only (the web tier / gateway sit inside the
 * network). A caller from any other address cannot choose its own client IP by sending the header.
 * Used as Fastify's `trustProxy` by the hrms service and the gateway -- never `true`.
 */
export const INTERNAL_PROXY_TRUST = "loopback,linklocal,uniquelocal";

/** Per-client bucket for the public resume upload (client = the first untrusted hop). */
export function resumeRateKey(tenantId: string, jobOpeningId: string, clientIp: string): string {
  return `${tenantId}:${jobOpeningId}:${clientIp}`;
}

/**
 * Coarse per-tenant cap on top of the per-client bucket (many clients cannot jointly flood one office's storage).
 * In-memory fixed window: per service instance, which is the intended granularity for an abuse backstop.
 */
export function createFixedWindowLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const buckets = new Map<string, { start: number; n: number }>();
  return {
    /** true = allowed. */
    hit(key: string): boolean {
      const t = now();
      const b = buckets.get(key);
      if (!b || t - b.start >= windowMs) { buckets.set(key, { start: t, n: 1 }); return true; }
      if (b.n >= max) return false;
      b.n += 1;
      return true;
    },
  };
}

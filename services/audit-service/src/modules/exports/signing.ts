import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * AUD-2: tamper-evident signing for audit export artifacts (the regulator
 * deliverable). An export gets two integrity controls:
 *
 *   1. contentSha256 — a SHA-256 digest of the exact artifact bytes. Any change
 *      to a single byte of the file changes this digest.
 *   2. signature — a detached HMAC-SHA256 over a *canonical manifest* that binds
 *      the content digest to the export's identity (exportId, tenantId, window,
 *      format, row count, PII flag) and the signing key id. This proves both that
 *      the bytes are unchanged AND that they belong to this export request, signed
 *      by a holder of the signing key. A regulator holding the key can recompute
 *      and verify without trusting the service.
 *
 * The signing secret is taken from EXPORT_SIGNING_KEY (falls back to JWT_SECRET so
 * the feature is always live in dev/test; production must set a dedicated key).
 * The signing *key id* (EXPORT_SIGNING_KEY_ID) is persisted with the artifact so
 * keys can be rotated and verifiers know which key to use.
 */

export const SIGNATURE_ALG = "HMAC-SHA256";

export function signingKeyId(): string {
  return process.env.EXPORT_SIGNING_KEY_ID ?? "audit-export-default";
}

function signingSecret(): string {
  const secret = process.env.EXPORT_SIGNING_KEY ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("export signing requires EXPORT_SIGNING_KEY (or JWT_SECRET) to be set");
  }
  return secret;
}

/** SHA-256 hex digest of the exact artifact bytes. */
export function contentDigest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export type ExportManifest = {
  exportId: string;
  tenantId: string;
  from: string;
  to: string;
  format: string;
  includesPii: boolean;
  rowCount: number;
  contentSha256: string;
  signingKeyId: string;
  alg: string;
};

/**
 * Canonical, stable serialization of the manifest. Keys are emitted in a fixed
 * order so the signed bytes are deterministic regardless of object construction
 * order — essential for the signature to be reproducible by a verifier.
 */
export function canonicalManifest(m: Omit<ExportManifest, "signingKeyId" | "alg">): string {
  const full: ExportManifest = { ...m, signingKeyId: signingKeyId(), alg: SIGNATURE_ALG };
  return JSON.stringify([
    ["alg", full.alg],
    ["contentSha256", full.contentSha256],
    ["exportId", full.exportId],
    ["format", full.format],
    ["from", full.from],
    ["includesPii", full.includesPii],
    ["rowCount", full.rowCount],
    ["signingKeyId", full.signingKeyId],
    ["tenantId", full.tenantId],
    ["to", full.to],
  ]);
}

/** Detached HMAC-SHA256 signature (hex) over the canonical manifest. */
export function signManifest(m: Omit<ExportManifest, "signingKeyId" | "alg">): string {
  return createHmac("sha256", signingSecret()).update(canonicalManifest(m)).digest("hex");
}

/**
 * Constant-time verification that (a) the bytes still hash to contentSha256 and
 * (b) the signature matches a freshly computed HMAC over the manifest. Returns a
 * structured result so callers can distinguish a content-tamper from a
 * signature-mismatch.
 */
export function verifyArtifact(
  content: string | Buffer,
  expected: { contentSha256: string; signature: string },
  m: Omit<ExportManifest, "signingKeyId" | "alg" | "contentSha256">,
): { ok: boolean; contentMatch: boolean; signatureMatch: boolean } {
  const actualDigest = contentDigest(content);
  const contentMatch = safeEqualHex(actualDigest, expected.contentSha256);
  const recomputed = signManifest({ ...m, contentSha256: expected.contentSha256 });
  const signatureMatch = safeEqualHex(recomputed, expected.signature);
  return { ok: contentMatch && signatureMatch, contentMatch, signatureMatch };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

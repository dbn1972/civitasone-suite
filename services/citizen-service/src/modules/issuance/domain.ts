/**
 * SVC-086 — pure issuance domain helpers (no I/O, unit-tested).
 *
 * Certificate numbers are gapless per (type, year): the caller supplies the next
 * sequence obtained under a row lock; this module only formats & validates it.
 * The signed output is a SHA-256 hash of the canonical payload plus an HMAC
 * signature over that hash, so a verifier can detect tampering without the
 * private secret being exposed.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

const TYPE_RE = /^[A-Z0-9_]{2,48}$/;

/** Normalise a certificate type token to the canonical uppercase form. */
export function normalizeCertType(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!TYPE_RE.test(t)) throw new Error(`INVALID_CERT_TYPE: ${raw}`);
  return t;
}

/** Format a gapless certificate number. `seq` MUST be a positive integer. */
export function buildCertNumber(certType: string, year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`INVALID_SEQ: ${seq}`);
  return `${normalizeCertType(certType)}-${year}-${String(seq).padStart(6, "0")}`;
}

/** Canonical JSON with sorted keys so the hash is stable across key ordering. */
export function canonicalize(payload: unknown): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) throw new Error("CIRCULAR_PAYLOAD");
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = norm((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  };
  return JSON.stringify(norm(payload));
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function issuanceSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.CITIZEN_ISSUANCE_SECRET ?? env.CITIZEN_PII_KEY ?? "civitasone-issuance-dev-secret";
}

/** HMAC-SHA256 signature (seal) over the payload hash. */
export function signPayloadHash(payloadHash: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", issuanceSecret(env)).update(payloadHash).digest("hex");
}

/** Verify a payload against a stored hash + signature (used by the public verify). */
export function verifySignature(payload: unknown, payloadHash: string, signature: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const recomputed = hashPayload(payload);
  if (recomputed !== payloadHash) return false;
  return signPayloadHash(payloadHash, env) === signature;
}

/** Opaque, URL-safe verification token embedded in the QR code. */
export function generateVerifyToken(): string {
  return randomBytes(24).toString("base64url");
}

/** True when a certificate has passed its validity window as of `now`. */
export function isExpired(validTo: string | Date | null | undefined, now = new Date()): boolean {
  if (!validTo) return false;
  const end = validTo instanceof Date ? validTo : new Date(`${validTo}T23:59:59.999Z`);
  return now.getTime() > end.getTime();
}

export const ACTIVE_STATES = ["active", "amended", "renewed"] as const;

/** A certificate is "valid" for public verification when active and unexpired. */
export function publicValidity(status: string, validTo: string | Date | null | undefined, now = new Date()): "valid" | "expired" | "invalid" {
  if (status === "cancelled" || status === "revoked" || status === "expired") return "invalid";
  if (status === "requested") return "invalid";
  if (isExpired(validTo, now)) return "expired";
  return "valid";
}

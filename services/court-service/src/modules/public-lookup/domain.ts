/**
 * public-lookup — PURE, security-critical domain helpers. No I/O.
 *
 * SECURITY INVARIANTS enforced here (self-contained, deterministic, unit-testable):
 *   • The OTP is NEVER logged and NEVER returned to the client — the ONLY exception
 *     is a `devOtp` surfaced by the route strictly when process.env.NODE_ENV === 'test'
 *     (so e2e/unit tests can complete the flow without an SMS gateway).
 *   • The mobile number is PII: it is stored ONLY as a peppered SHA-256 hash
 *     (`hashMobile`). The raw mobile leaves this service exactly once — in the
 *     fire-and-forget SMS dispatch — and is never persisted.
 *   • The OTP is stored ONLY as a salted SHA-256 hash (`hashOtp`, salt = challenge id).
 *   • OTP verification uses a CONSTANT-TIME comparison (`constantTimeEqualHex`) to
 *     avoid timing side-channels.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Pepper mixed into the mobile hash so a leaked DB alone cannot be brute-forced back
 * to phone numbers without also holding the app secret. Sourced from the environment;
 * a fixed dev fallback keeps local/test deterministic (production MUST set the env).
 */
const OTP_PEPPER = ((): string => {
  const p = process.env.COURT_OTP_PEPPER;
  if (p) return p;
  // Fail-fast in production (mirrors shared/db.ts): a hardcoded pepper would let a
  // DB read reverse mobile hashes back to real numbers.
  if (process.env.NODE_ENV === "production") {
    throw new Error("COURT_OTP_PEPPER is required in production (public-lookup mobile hashing)");
  }
  return "court-otp-dev-pepper-do-not-use-in-prod";
})();

/** UUIDv5 namespace for public-lookup deterministic ids (distinct per module). */
export const COURT_NAMESPACE = "b2e7a4d1-9c33-4f0a-8e21-5d6c7b8a9f01";

/** SHA-256 hex of an arbitrary string. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Normalize a mobile number to its last 10 digits (India MSISDN core), stripping
 * spaces, dashes, +country-code, etc. Throws INVALID_MOBILE if <10 digits remain.
 */
export function normalizeMobile(m: string): string {
  const digits = (m ?? "").replace(/\D/g, "");
  if (digits.length < 10) {
    throw new Error("INVALID_MOBILE");
  }
  return digits.slice(-10);
}

/**
 * Peppered SHA-256 of the normalized mobile — the ONLY representation of the mobile
 * that is ever stored. Deterministic for a given (pepper, mobile).
 */
export function hashMobile(mobile: string): string {
  return sha256Hex(`${OTP_PEPPER}:${normalizeMobile(mobile)}`);
}

/**
 * Salted SHA-256 of the OTP, salt = the challenge id. The per-challenge salt means
 * two challenges with the same OTP produce different hashes, so a stolen hash cannot
 * be replayed against another challenge.
 */
export function hashOtp(otp: string, salt: string): string {
  return sha256Hex(`${salt}:${otp}`);
}

/** Cryptographically-secure 6-digit OTP, zero-padded (000000–999999). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Constant-time compare of two equal-length hex strings. Returns false (without
 * leaking via early-exit) if the lengths differ. Used for OTP-hash verification.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  // Buffer.from with an odd/invalid hex string can yield mismatched lengths; guard.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Normalize a CNR (uppercase, strip whitespace) and return its first 6 chars. */
export function cnrPrefix(cnr: string): string {
  return (cnr ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 6);
}

/**
 * The whitelist of case fields exposed to an anonymous public caller. Any field NOT
 * in this set (parties, contact PII, internal ids, bench, filing number, versions,
 * audit columns) is NEVER returned.
 */
export const PUBLIC_CASE_FIELDS = [
  "cnrNumber", "caseType", "title", "status", "stage", "filingDate", "disposalDate",
] as const;

/** Minimal row shape needed to build a public docket (a subset of CaseRow). */
export interface PublicDocketSource {
  cnrNumber: string;
  caseType: string | null;
  title: string | null;
  status: string;
  stage: string | null;
  filingDate: string | null;
  disposalDate: string | null;
}

export interface PublicDocket {
  cnrNumber: string;
  caseType: string | null;
  title: string | null;
  status: string;
  stage: string | null;
  filingDate: string | null;
  disposalDate: string | null;
}

/**
 * Project a case row down to the PUBLIC docket — ONLY the whitelisted fields. This
 * is the sole exit point for case data to the public, so it is written as an explicit
 * allow-list (never a delete-list) so a new PII column on `cases` can never leak by
 * default.
 */
export function toPublicDocket(row: PublicDocketSource): PublicDocket {
  return {
    cnrNumber:    row.cnrNumber,
    caseType:     row.caseType ?? null,
    title:        row.title ?? null,
    status:       row.status,
    stage:        row.stage ?? null,
    filingDate:   row.filingDate ?? null,
    disposalDate: row.disposalDate ?? null,
  };
}

/** RFC 4122 §4.3 UUIDv5 over a fixed namespace + name → stable, collision-free id. */
export function deterministicId(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(nsBytes).update(nameBytes).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Deterministic id for a public-establishment directory row, stable on
 * (tenantId + establishmentCode) so re-publishing the same establishment is
 * idempotent end-to-end.
 */
export function deriveEstablishmentDirId(tenantId: string, establishmentCode: string): string {
  const code = establishmentCode.replace(/\s+/g, "").toUpperCase();
  return deterministicId(COURT_NAMESPACE, `${tenantId}:public-establishment:${code}`);
}

// ─── Access method (per-tenant configurable via config namespace "public_lookup") ─

export const ACCESS_MODES = ["otp", "captcha", "open"] as const;
export type AccessMode = typeof ACCESS_MODES[number];

/** Coerce a config value (a bare string, {mode}, or {value}) into an access mode;
 *  defaults to the most private option, 'otp', for any unrecognised/absent value. */
export function resolveAccessMode(value: unknown): AccessMode {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? String((value as { mode?: unknown }).mode ?? (value as { value?: unknown }).value ?? "")
        : "";
  const m = raw.trim().toLowerCase();
  return (ACCESS_MODES as readonly string[]).includes(m) ? (m as AccessMode) : "otp";
}

/**
 * Captcha verification for the 'captcha' access mode (the eCourts / High-Court /
 * Supreme-Court style gate). A real provider (hCaptcha / reCAPTCHA) MUST be wired
 * for production via COURT_CAPTCHA_SECRET — until then production FAILS CLOSED.
 * Outside production a fixed dev token (COURT_CAPTCHA_DEV_TOKEN, default
 * 'test-captcha-ok') is accepted so the flow is testable end-to-end.
 */
export function verifyCaptcha(token: string | undefined): boolean {
  if (!token) return false;
  if (process.env.NODE_ENV === "production") {
    // TODO(integrator): verify `token` with the configured captcha provider.
    return false;
  }
  // Non-production: accept a dev token ONLY if COURT_CAPTCHA_DEV_TOKEN is EXPLICITLY
  // set (no baked-in default), so an unset/misconfigured NODE_ENV fails closed rather
  // than accepting a well-known string.
  const devToken = process.env.COURT_CAPTCHA_DEV_TOKEN;
  return typeof devToken === "string" && devToken.length > 0 && token === devToken;
}

/** The shareable PUBLIC case-status page link a court publishes for its citizens,
 *  e.g. https://courts.gov.in/case-status/<public-slug>. Base from
 *  COURT_PUBLIC_PORTAL_BASE. */
export function publicCaseUrl(slug: string): string {
  const base = (process.env.COURT_PUBLIC_PORTAL_BASE ?? "https://courts.gov.in").replace(/\/+$/, "");
  return `${base}/case-status/${slug}`;
}

/** Peppered SHA-256 of the caller IP — for per-IP OTP-request rate limiting. The raw
 *  IP is never stored. */
export function hashIp(ip: string | undefined): string {
  return createHash("sha256").update(`${OTP_PEPPER}:ip:${ip ?? "unknown"}`).digest("hex");
}

/**
 * Server-side PII masking for the free-form profile attribute bag (DPDP
 * data-minimisation). The service is the authority: a non-admin principal
 * (cdp_user, cdp_steward, ...) never receives cleartext direct identifiers.
 * The web masks again as defence in depth but must not be the only control.
 *
 * Classification is PATTERN based, not an exact-name denylist, so keys such as
 * `emailAddress`, `mobileNumber`, `primary_phone` or `panNumber` are caught:
 *   1. KEY: the key is split into camelCase / snake / kebab tokens; a token
 *      (or, for the long unambiguous ones, a substring of the compacted key)
 *      matching email, phone, mobile, contact, pan, aadhaar/aadhar, uid, dob,
 *      dateofbirth or address marks the value sensitive. Short tokens (pan,
 *      uid, dob) are matched as whole tokens only so `company` / `guid` /
 *      `panel` are not over-masked.
 *   2. VALUE: any string that LOOKS like an email, an Indian/E.164 phone, or a
 *      12-digit id (Aadhaar) is masked regardless of its key.
 */

import { HttpError } from "./context.js";

/** Roles that may see cleartext PII. Everyone else is masked. */
export const CDP_PII_CLEARTEXT_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

export function canSeeCleartextPii(ctx: { roles: readonly string[] }): boolean {
  return ctx.roles.some((r) => CDP_PII_CLEARTEXT_ROLES.includes(r));
}

type Kind = "email" | "phone" | "pan" | "aadhaar" | "generic";

const TOKEN_KIND: Record<string, Kind> = {
  email: "email", emails: "email", mail: "email",
  phone: "phone", phones: "phone", mobile: "phone", mobiles: "phone",
  contact: "phone", contacts: "phone", msisdn: "phone", tel: "phone",
  pan: "pan",
  aadhaar: "aadhaar", aadhar: "aadhaar", uid: "aadhaar",
  dob: "generic", address: "generic", addresses: "generic",
};
/** Long, unambiguous fragments safe to match as substrings of the compacted key. */
const SUBSTRING_KIND: Array<[string, Kind]> = [
  ["email", "email"], ["phone", "phone"], ["mobile", "phone"], ["aadhaar", "aadhaar"],
  ["aadhar", "aadhaar"], ["dateofbirth", "generic"], ["birthdate", "generic"], ["address", "generic"],
];

function tokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

export function classifyKey(key: string): Kind | null {
  for (const t of tokens(key)) {
    const k = TOKEN_KIND[t];
    if (k) return k;
  }
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [frag, kind] of SUBSTRING_KIND) if (compact.includes(frag)) return kind;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$|^\+\d{1,3}[\s-]?\d{6,14}$/;
const TWELVE_DIGIT_RE = /^\d{4}[\s-]?\d{4}[\s-]?\d{4}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export function classifyValue(value: string): Kind | null {
  const v = value.trim();
  if (EMAIL_RE.test(v)) return "email";
  if (TWELVE_DIGIT_RE.test(v)) return "aadhaar";
  if (PAN_RE.test(v)) return "pan";
  if (PHONE_RE.test(v)) return "phone";
  return null;
}

function maskGeneric(v: string): string {
  const t = v.trim();
  if (t.length <= 2) return "**";
  if (t.length <= 6) return `${t[0]}${"*".repeat(t.length - 1)}`;
  return `${t.slice(0, 2)}${"*".repeat(Math.max(t.length - 4, 2))}${t.slice(-2)}`;
}

function maskByKind(kind: Kind, raw: string): string {
  const v = raw.trim();
  switch (kind) {
    case "email": {
      const at = v.indexOf("@");
      if (at <= 0 || at === v.length - 1) return maskGeneric(v);
      const domain = v.slice(at + 1)
        .split(".")
        .map((l) => (l ? `${l[0]}${"*".repeat(Math.max(l.length - 1, 1))}` : ""))
        .join(".");
      return `${v[0]}***@${domain}`;
    }
    case "phone": {
      const digits = v.replace(/\D/g, "");
      if (digits.length < 7) return "X".repeat(Math.max(digits.length, 4));
      return `${digits.slice(0, 2)}${"X".repeat(digits.length - 5)}${digits.slice(-3)}`;
    }
    case "pan":
      return v.length === 10 ? `${v.slice(0, 5)}****${v.slice(9)}` : "*".repeat(Math.min(Math.max(v.length, 4), 10));
    case "aadhaar": {
      const digits = v.replace(/\D/g, "");
      return digits.length < 4 ? "XXXX" : `XXXX XXXX ${digits.slice(-4)}`;
    }
    default:
      return maskGeneric(v);
  }
}

/** Free text: mask identifiers embedded in a longer string ("call 98765 43210"). */
function maskEmbedded(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, (m) => maskByKind("email", m))
    .replace(/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, (m) => maskByKind("aadhaar", m))
    .replace(/(?<!\d)(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, (m) => maskByKind("phone", m));
}

/** Mask every scalar beneath a key already classified as sensitive. */
function maskAll(value: unknown, kind: Kind): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((x) => maskAll(x, kind));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskAll(v, kind)]));
  }
  return maskByKind(kind, String(value));
}

function maskValue(key: string | null, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const keyKind = key === null ? null : classifyKey(key);
  if (keyKind) return maskAll(value, keyKind);
  if (typeof value === "string") {
    const k = classifyValue(value);
    return k ? maskByKind(k, value) : maskEmbedded(value);
  }
  if (Array.isArray(value)) return value.map((x) => maskValue(null, x));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskValue(k, v)]));
  }
  return value;
}

/** Mask a profile attribute bag (pure; does not mutate the input). */
export function maskAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  return maskValue(null, attrs ?? {}) as Record<string, unknown>;
}

/**
 * Role-aware profile view: non-admin principals get the attribute bag masked,
 * cdp_admin / super_admin / tenant_admin get cleartext. Applied to the output
 * of the repo's toView so it works for any view carrying `attributes`.
 */
export function maskProfileView<T extends { attributes: unknown }>(ctx: { roles: readonly string[] }, view: T): T {
  if (canSeeCleartextPii(ctx)) return view;
  return { ...view, attributes: maskAttributes((view.attributes ?? {}) as Record<string, unknown>) };
}

/**
 * GAP-CDP-PROFILES-06 (owner decision D4c #1): data minimisation at ingest. Returns the
 * dotted path of the first Aadhaar-like value in `input`, or null. Aadhaar-like means a
 * 12-digit id (plain, space- or dash-grouped) or ANY non-empty value under an
 * Aadhaar-named key. Only the PATH is returned, never the value, so callers can refuse
 * without echoing the identifier back or logging it.
 */
export function findAadhaarLike(input: unknown, path = ""): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return TWELVE_DIGIT_RE.test(input.trim()) ? path || "(value)" : null;
  if (typeof input === "number") return /^\d{12}$/.test(String(input)) ? path || "(value)" : null;
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      const hit = findAadhaarLike(input[i], path ? `${path}.${i}` : String(i));
      if (hit) return hit;
    }
    return null;
  }
  if (typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const here = path ? `${path}.${k}` : k;
      if (classifyKey(k) === "aadhaar" && v !== null && v !== undefined && v !== "") return here;
      const hit = findAadhaarLike(v, here);
      if (hit) return hit;
    }
  }
  return null;
}

/** Throw 422 when `input` carries an Aadhaar-like value; message names the path, never the value. */
export function assertNoAadhaarLike(input: unknown): void {
  const at = findAadhaarLike(input);
  if (at) throw new HttpError(422, "AADHAAR_NOT_ACCEPTED", `identity numbers (Aadhaar) are not accepted; remove the value at "${at}"`);
}

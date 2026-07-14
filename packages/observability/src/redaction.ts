/**
 * Structured-log / Drill_Report redaction sanitizer (Req 15.4, 3.5, 4.4, 13.1, 13.4).
 *
 * Two distinct, intentionally different policies:
 *
 *   - `redactLogPayload()` — for structured log entries emitted by the
 *     Provisioning_Actuator, Read_Router, connection-budget verification check, or
 *     Drill_Scheduler. Strips BOTH credential-/DSN-shaped fields (password, dsn,
 *     connection string, secret, token, api key) AND PII-shaped fields (email,
 *     aadhaar, phone, PAN, bank account) — logs must never contain tenant PII
 *     (see `tech.md`: "NEVER log PII"). Always leaves a non-empty `correlationId`
 *     on the returned payload, generating one when absent/empty so every log line
 *     stays traceable.
 *
 *   - `redactReportPayload()` — for the durable Drill_Report artifact. Strips ONLY
 *     credential-/DSN-shaped fields. Deliberately leaves PII-shaped fields (email,
 *     aadhaar, etc.) untouched, because a Drill_Report's sample-row check output is
 *     tenant-record content that already exists at rest in the tenant's own
 *     database (Req 13.4) — the report-redaction policy removes credentials only,
 *     never PII.
 *
 * Both functions walk arbitrary nested structured-log/report objects recursively:
 * a field is redacted either because its *key* matches a known credential/PII
 * field name, or because a *string value* matches a credential/PII-shaped pattern
 * (e.g. a raw Postgres error message that happens to embed a DSN).
 */
import { randomUUID } from "node:crypto";

export type RedactionMode = "log" | "report";

/** Field names (normalized: lowercased, non-alphanumeric stripped) treated as credential-shaped. */
const CREDENTIAL_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "dsn",
  "connectionstring",
  "databaseurl",
  "secret",
  "secretkey",
  "clientsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "privatekey",
  "accesskey",
  "awssecretaccesskey",
]);

/** Field names (normalized) treated as PII-shaped. Only stripped in "log" mode. */
const PII_KEYS = new Set([
  "email",
  "aadhaar",
  "aadhaarnumber",
  "pan",
  "phone",
  "phonenumber",
  "mobile",
  "bankaccount",
  "bankaccountnumber",
  "ifsc",
]);

const REDACTED = "[REDACTED]";
const REDACTED_DSN = "[REDACTED_DSN]";
const REDACTED_EMAIL = "[REDACTED_EMAIL]";
const REDACTED_AADHAAR = "[REDACTED_AADHAAR]";

/** Matches scheme://user:pass@host-shaped connection strings (postgres, redis, amqp, mongodb, etc). */
const DSN_VALUE_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*:[^\s"'<>]*@[^\s"'<>]+/gi;
/** Matches `key: value` / `key=value` credential assignments embedded in free text (e.g. error messages). */
const SECRET_KV_PATTERN = /\b((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi;
/** Matches `Bearer <token>` Authorization-header-shaped substrings. */
const BEARER_VALUE_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
/** Standard email address shape. Only applied in "log" mode. */
const EMAIL_VALUE_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** Aadhaar: 12 digits, optionally grouped 4-4-4. Only applied in "log" mode. */
const AADHAAR_VALUE_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Scrub credential-shaped (and, in "log" mode, PII-shaped) patterns out of a string leaf value. */
function redactString(value: string, mode: RedactionMode): string {
  let out = value
    .replace(DSN_VALUE_PATTERN, REDACTED_DSN)
    .replace(SECRET_KV_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_VALUE_PATTERN, `$1${REDACTED}`);
  if (mode === "log") {
    out = out.replace(EMAIL_VALUE_PATTERN, REDACTED_EMAIL).replace(AADHAAR_VALUE_PATTERN, REDACTED_AADHAAR);
  }
  return out;
}

/** Recursively redact a value (object/array/primitive) per the given mode. */
function redactValue(value: unknown, mode: RedactionMode): unknown {
  if (typeof value === "string") return redactString(value, mode);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, mode));
  if (value !== null && typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      if (CREDENTIAL_KEYS.has(normalized)) {
        out[key] = REDACTED;
        continue;
      }
      if (mode === "log" && PII_KEYS.has(normalized)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactValue(val, mode);
    }
    return out;
  }
  return value;
}

function hasNonEmptyCorrelationId(payload: Record<string, unknown>): boolean {
  const value = payload.correlationId;
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Redact a structured log payload before it is logged: strips credential- and
 * PII-shaped fields (by key name and by in-string pattern), then guarantees the
 * returned object carries a non-empty `correlationId` — generating one via
 * `randomUUID()` when the input payload omitted it or supplied an empty value.
 *
 * Used by the Provisioning_Actuator, Read_Router, connection-budget verification
 * check, and Drill_Scheduler before emitting any structured log entry.
 */
export function redactLogPayload<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const redacted = redactValue(payload, "log") as Record<string, unknown>;
  if (!hasNonEmptyCorrelationId(redacted)) {
    redacted.correlationId = randomUUID();
  }
  return redacted;
}

/**
 * Redact a Drill_Report (or other durable-artifact) payload before persistence:
 * strips ONLY credential-/DSN-shaped fields. Tenant-record-shaped PII fields
 * (email, aadhaar, etc.) surfaced by the sample-row check are deliberately left
 * untouched — the report-redaction policy removes credentials only, never PII
 * (Req 13.4).
 */
export function redactReportPayload<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  return redactValue(payload, "report") as Record<string, unknown>;
}

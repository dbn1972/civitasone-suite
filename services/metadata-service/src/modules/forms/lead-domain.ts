/**
 * LM-002 — input safety for the PUBLIC, UNAUTHENTICATED lead-capture endpoint,
 * plus UTM attribution normalisation.
 *
 * Everything in this file exists because the caller is anonymous and hostile by
 * assumption. Pure functions only, so each bound is unit-testable without a
 * request.
 *
 * ── Why reject markup instead of sanitising it ────────────────────────────────
 * Submissions are rendered later by the web app and possibly by a CRM UI we do
 * not control. Sanitising HTML means owning an allow-list forever and being
 * wrong once; storing raw HTML means a stored-XSS payload sits in the database
 * waiting for the one consumer that renders it unescaped. So we do neither: a
 * value containing markup or an HTML entity is REFUSED at the boundary. A lead
 * form asking for a name, a phone and a message has no legitimate need for `<`.
 *
 * ── Why errors never echo the input ───────────────────────────────────────────
 * `describeRejection` returns the field name and the reason, never the value.
 * Reflecting submitted content back would make the endpoint a reflected-XSS
 * gadget and an oracle for probing the filter.
 */

/** Hard bound on any single answer value. */
export const MAX_ANSWER_LENGTH = 2000;
/** Hard bound on a UTM parameter value. Real UTM values are short; long ones are abuse. */
export const MAX_UTM_LENGTH = 200;
/** Hard bound on the number of answers accepted in one submission. */
export const MAX_ANSWER_COUNT = 100;
/** Hard bound on the raw request body, enforced by Fastify's per-route bodyLimit. */
export const MAX_BODY_BYTES = 32 * 1024;

/** The five UTM parameters captured alongside every submission. */
export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

/** Markup, HTML entities, and javascript/data URLs. */
const MARKUP_RE = /[<>]|&#|&[a-zA-Z][a-zA-Z0-9]{1,9};|javascript:|data:text\/html/i;
/** C0/C1 control characters other than tab, newline and carriage return. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface Rejection {
  field: string;
  reason: "too_long" | "markup_not_allowed" | "control_characters" | "unsupported_type" | "too_many_fields" | "unknown_field";
}

/** Human-readable, input-free message for a rejection. */
export function describeRejection(r: Rejection): string {
  switch (r.reason) {
    case "too_long":
      return `field "${r.field}" exceeds the maximum accepted length`;
    case "markup_not_allowed":
      return `field "${r.field}" must not contain markup`;
    case "control_characters":
      return `field "${r.field}" contains unsupported control characters`;
    case "unsupported_type":
      return `field "${r.field}" has an unsupported value type`;
    case "too_many_fields":
      return "the submission contains too many fields";
    case "unknown_field":
      return `field "${r.field}" is not part of this form`;
  }
}

/** True when a string carries markup, an HTML entity, or a script/data URL. */
export function containsMarkup(value: string): boolean {
  return MARKUP_RE.test(value);
}

/** True when a string carries disallowed control characters. */
export function containsControlChars(value: string): boolean {
  return CONTROL_RE.test(value);
}

/**
 * Check a single scalar answer. Objects, arrays and functions are refused
 * outright — an anonymous caller does not get to nest arbitrary structure into
 * a jsonb/encrypted column.
 */
export function checkScalar(field: string, value: unknown, maxLength = MAX_ANSWER_LENGTH): Rejection | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : { field, reason: "unsupported_type" };
  if (typeof value === "boolean") return null;
  if (typeof value !== "string") return { field, reason: "unsupported_type" };
  if (value.length > maxLength) return { field, reason: "too_long" };
  if (containsControlChars(value)) return { field, reason: "control_characters" };
  if (containsMarkup(value)) return { field, reason: "markup_not_allowed" };
  return null;
}

export interface AnswerCheckResult {
  rejections: Rejection[];
  /** Trimmed, bounded answers — only present when there are no rejections. */
  answers: Record<string, string | number | boolean | null>;
}

/**
 * Validate and normalise the answer map. `allowedFields` is the form's declared
 * field api-names; anything else is refused (not silently dropped) so a
 * misconfigured integration is visible rather than losing data quietly.
 */
export function checkAnswers(
  raw: Record<string, unknown>,
  allowedFields: string[],
): AnswerCheckResult {
  const rejections: Rejection[] = [];
  const entries = Object.entries(raw);
  if (entries.length > MAX_ANSWER_COUNT) {
    return { rejections: [{ field: "answers", reason: "too_many_fields" }], answers: {} };
  }

  const allowed = new Set(allowedFields);
  const answers: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key)) {
      rejections.push({ field: key, reason: "unknown_field" });
      continue;
    }
    const bad = checkScalar(key, value);
    if (bad) {
      rejections.push(bad);
      continue;
    }
    answers[key] = typeof value === "string" ? value.trim() : (value as number | boolean | null);
  }
  return { rejections, answers };
}

/**
 * Validate the UTM block. Each value is length-bounded independently of the
 * answer bound because UTM values land in fixed-width varchar columns; an
 * oversized one is a rejection, never a silent truncation (truncating would
 * corrupt campaign attribution reporting).
 */
export function checkUtm(raw: Record<string, unknown>): { rejections: Rejection[]; utm: UtmParams } {
  const rejections: Rejection[] = [];
  const utm: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    const bad = checkScalar(`utm.${key}`, value, MAX_UTM_LENGTH);
    if (bad) {
      rejections.push(bad);
      continue;
    }
    utm[key] = String(value).trim();
  }
  return { rejections, utm };
}

/**
 * Summarise rejections for a response that must NOT reflect submitted content.
 *
 * `describeRejection` embeds the field name, which is fine when the name is one
 * the server declared. For an `unknown_field` the name came from the request, so
 * echoing it would turn the error response into a reflection gadget and an
 * oracle for probing the filter. Those are reported as a count and a reason code
 * with no name attached.
 */
export function publicSafeRejectionSummary(
  rejections: Rejection[],
  serverDeclaredFields: string[],
): { reasons: string[]; rejectedCount: number } {
  const declared = new Set(serverDeclaredFields);
  const reasons = new Set<string>();
  for (const r of rejections) {
    reasons.add(declared.has(r.field) || r.field.startsWith("utm.") || r.field === "answers"
      ? describeRejection(r)
      : `a submitted field was rejected: ${r.reason}`);
  }
  return { reasons: [...reasons], rejectedCount: rejections.length };
}

/**
 * Parse UTM parameters out of a landing-page URL's query string. Web forms
 * frequently forward the whole landing URL rather than the parsed parameters;
 * this accepts either. An unparseable URL yields no UTM rather than an error —
 * missing attribution must not cost us the lead.
 */
export function utmFromUrl(landingUrl: string): UtmParams {
  let params: URLSearchParams;
  try {
    params = new URL(landingUrl).searchParams;
  } catch {
    return {};
  }
  const utm: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value !== null && value !== "" && value.length <= MAX_UTM_LENGTH && !containsMarkup(value)) {
      utm[key] = value;
    }
  }
  return utm;
}

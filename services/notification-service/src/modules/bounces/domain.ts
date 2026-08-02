/**
 * INT-12 — Hard/soft bounce classification (pure domain logic).
 *
 * Classification is driven by the SMTP status the receiving MTA reported, per
 * RFC 3463 Enhanced Mail System Status Codes and RFC 5321 reply codes:
 *
 *   - 5.x.x enhanced status / 5xx reply code  → PERMANENT failure  → HARD bounce
 *   - 4.x.x enhanced status / 4xx reply code  → TRANSIENT failure  → SOFT bounce
 *
 * Two documented deviations from a naive first-digit read, because real ESPs
 * classify them the other way round and getting them wrong either suppresses a
 * good address or keeps hammering a dead one:
 *
 *   - 5.2.2 "mailbox full" is a *permanent* code that describes a *temporary*
 *     condition. Treated as SOFT (the mailbox can be emptied).
 *   - 4.7.x policy/auth failures ("blocked", "spam", "reputation") are transient
 *     codes that in practice mean the receiver is refusing us, not that the
 *     mailbox is unavailable. Kept SOFT (retryable) but see reason keywords —
 *     an explicit "user unknown" in the reason text always wins as HARD.
 *
 * When no usable code is present we fall back to reason-text keywords, and if
 * that also fails we return "unknown" rather than guessing: an unknown bounce
 * must NEVER feed the suppression list, because a false hard bounce
 * permanently blocks a legitimate recipient.
 */

export type BounceClassification = "hard" | "soft" | "unknown";

export type BounceSignal = {
  /** SMTP reply code (e.g. "550") or enhanced status (e.g. "5.1.1"). */
  smtpCode?: string | null | undefined;
  /** Free-text diagnostic from the MTA / ESP webhook. */
  reason?: string | null | undefined;
};

/** Enhanced status codes that override the first-digit rule. */
const SOFT_OVERRIDE_ENHANCED = new Set([
  "5.2.2", // mailbox full — permanent code, temporary condition
  "5.3.1", // mail system full
  "5.3.4", // message too big for system (resend smaller, address is fine)
]);

const HARD_OVERRIDE_ENHANCED = new Set([
  "4.1.1", // some MTAs emit a transient code for an unknown mailbox
]);

/** Reason keywords that unambiguously indicate a non-existent recipient. */
const HARD_REASON_PATTERNS = [
  "user unknown",
  "unknown user",
  "no such user",
  "no such recipient",
  "recipient address rejected",
  "does not exist",
  "invalid recipient",
  "address rejected",
  "unrouteable address",
  "mailbox unavailable",
  "account disabled",
  "account has been disabled",
];

/** Reason keywords that indicate a retryable condition. */
const SOFT_REASON_PATTERNS = [
  "mailbox full",
  "over quota",
  "quota exceeded",
  "insufficient storage",
  "try again later",
  "temporarily deferred",
  "temporary failure",
  "greylist",
  "greylisted",
  "connection timed out",
  "too many connections",
  "rate limited",
  "throttled",
  "service unavailable",
];

/** Extract the enhanced status code ("5.1.1") from a code string, if present. */
function enhancedStatus(code: string): string | null {
  const m = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(code);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Extract the 3-digit SMTP reply code ("550") from a code string, if present. */
function replyCode(code: string): number | null {
  const m = /\b([245]\d{2})\b/.exec(code);
  if (!m?.[1]) return null;
  return Number.parseInt(m[1], 10);
}

function classifyByReason(reason: string): BounceClassification {
  const r = reason.toLowerCase();
  // Hard patterns are checked first: "mailbox unavailable" beats a generic
  // "try again" boilerplate suffix that some MTAs append to every DSN.
  for (const p of HARD_REASON_PATTERNS) if (r.includes(p)) return "hard";
  for (const p of SOFT_REASON_PATTERNS) if (r.includes(p)) return "soft";
  return "unknown";
}

/**
 * Classify a bounce as hard (permanent — suppress immediately), soft
 * (transient — count toward a threshold) or unknown (never suppress).
 */
export function classifyBounce(signal: BounceSignal): BounceClassification {
  const code = (signal.smtpCode ?? "").trim();
  const reason = (signal.reason ?? "").trim();

  if (code.length > 0) {
    const enhanced = enhancedStatus(code);
    if (enhanced) {
      if (SOFT_OVERRIDE_ENHANCED.has(enhanced)) return "soft";
      if (HARD_OVERRIDE_ENHANCED.has(enhanced)) return "hard";
      if (enhanced.startsWith("5.")) {
        // A permanent code plus an explicit transient reason (mailbox full
        // phrased without the 5.2.2 code) is still soft.
        if (reason.length > 0 && classifyByReason(reason) === "soft") return "soft";
        return "hard";
      }
      if (enhanced.startsWith("4.")) {
        if (reason.length > 0 && classifyByReason(reason) === "hard") return "hard";
        return "soft";
      }
      return "unknown"; // 2.x.x is a success code — not a bounce
    }

    const reply = replyCode(code);
    if (reply !== null) {
      if (reply >= 500 && reply <= 599) {
        if (reason.length > 0 && classifyByReason(reason) === "soft") return "soft";
        return "hard";
      }
      if (reply >= 400 && reply <= 499) {
        if (reason.length > 0 && classifyByReason(reason) === "hard") return "hard";
        return "soft";
      }
      return "unknown"; // 2xx is not a bounce
    }
  }

  if (reason.length > 0) return classifyByReason(reason);
  return "unknown";
}

export const DEFAULT_SOFT_BOUNCE_THRESHOLD = 5;

/**
 * Read the soft-bounce suppression threshold. Configurable, never hardcoded at
 * the call site: per-tenant setting wins, then NOTIFICATION_SOFT_BOUNCE_THRESHOLD,
 * then the documented default of 5.
 */
export function resolveSoftBounceThreshold(
  tenantSetting?: number | null | undefined,
  env: Record<string, string | undefined> = process.env,
): number {
  if (typeof tenantSetting === "number" && Number.isInteger(tenantSetting) && tenantSetting > 0) {
    return tenantSetting;
  }
  const raw = env.NOTIFICATION_SOFT_BOUNCE_THRESHOLD;
  if (raw !== undefined && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SOFT_BOUNCE_THRESHOLD;
}

export type SuppressionDecision =
  | { suppress: false; reason: "transient" | "not_a_bounce" }
  | { suppress: true; reason: "hard_bounce" | "soft_bounce_threshold" };

/**
 * Decide whether a bounce should put the recipient on the suppression list.
 *
 * `softBounceCount` is the recipient's soft-bounce total INCLUDING the bounce
 * being classified now, so a threshold of 5 suppresses on the 5th soft bounce.
 */
export function decideSuppression(
  classification: BounceClassification,
  softBounceCount: number,
  threshold: number,
): SuppressionDecision {
  if (classification === "hard") return { suppress: true, reason: "hard_bounce" };
  if (classification === "unknown") return { suppress: false, reason: "not_a_bounce" };
  if (softBounceCount >= threshold) return { suppress: true, reason: "soft_bounce_threshold" };
  return { suppress: false, reason: "transient" };
}

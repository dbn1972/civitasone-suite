/**
 * FN-15 — Renewal / Amendment / Surrender lifecycle (pure domain, no I/O).
 *
 * BRD acceptance: "Trade License renewal prefills and blocks outside window."
 *
 * The Designer already authors the inputs (issuanceTypes.ts: renewable,
 * renewalWindowDays, validityMode, validityYears, validityFixedDate). What was
 * missing is the runtime decision: given an issued licence, may this applicant
 * renew *today*, and if not, what do we tell them? This module answers that and
 * nothing else — no DB, no clock reads beyond the `now` the caller passes, so
 * the answer is reproducible in tests and in a sandbox run.
 *
 * Deliberately NOT modelled: late renewal with penalty after expiry. Several
 * licence regimes allow it, but the BRD says "blocks outside window" and does
 * not define a grace period or penalty basis — inventing one here would put a
 * fee rule in the wrong layer. `expired` is therefore terminal for renewal and
 * the citizen is told to apply afresh; if a grace policy is later specified it
 * belongs in the pack (B5/B7), not in this function.
 */

/** How a pack expresses how long its output stays valid. */
export type ValidityMode = "none" | "duration" | "fixed_date";

export interface RenewalPolicy {
  renewable: boolean;
  /** Days before expiry when renewal opens. 0 = opens only on the expiry date. */
  renewalWindowDays: number;
  validityMode: ValidityMode;
  /** Used when validityMode = "duration". */
  validityYears?: number | undefined;
  /** ISO date, used when validityMode = "fixed_date". */
  validityFixedDate?: string | undefined;
}

export type RenewalState =
  /** Pack does not offer renewal, or its output never expires. */
  | "not_renewable"
  /** Renewal exists but the window has not opened yet. */
  | "too_early"
  /** Renewal is open now. */
  | "open"
  /** Validity has lapsed — a fresh application is required. */
  | "expired";

export interface RenewalEligibility {
  state: RenewalState;
  /** Expiry of the current licence, when it has one. */
  validTo?: string | undefined;
  /** First day the citizen may renew, when renewal is offered. */
  opensAt?: string | undefined;
  /** Plain-language reason, safe to show a citizen (UX P6: what + why + next). */
  reason: string;
}

const DAY_MS = 86_400_000;

/** Midnight-UTC day key, so comparisons are date-based not time-of-day-based. */
function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Expiry of an output issued at `issuedAt` under `policy`.
 * Returns null when the output does not expire (validityMode "none").
 */
export function computeValidTo(policy: RenewalPolicy, issuedAt: Date): string | null {
  if (policy.validityMode === "none") return null;

  if (policy.validityMode === "fixed_date") {
    const raw = policy.validityFixedDate;
    if (!raw) return null;
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    return toIsoDate(dayStart(new Date(parsed)));
  }

  // duration
  const years = policy.validityYears ?? 0;
  if (!Number.isFinite(years) || years <= 0) return null;
  const start = new Date(dayStart(issuedAt));
  // setUTCFullYear keeps calendar semantics: 29 Feb + 1 year lands on 1 Mar,
  // which is what a licence clerk would do rather than subtracting a day.
  start.setUTCFullYear(start.getUTCFullYear() + years);
  return toIsoDate(start.getTime());
}

/**
 * May this licence be renewed as at `now`?
 *
 * `now` is injected rather than read from the clock so sandbox runs (FN-10) and
 * tests are deterministic.
 */
export function renewalEligibility(
  policy: RenewalPolicy,
  issuedAt: Date,
  now: Date,
): RenewalEligibility {
  if (!policy.renewable) {
    return { state: "not_renewable", reason: "This service is not renewable — apply afresh when you need it again." };
  }

  const validTo = computeValidTo(policy, issuedAt);
  if (validTo == null) {
    return {
      state: "not_renewable",
      reason: "This service has no expiry date, so there is nothing to renew.",
    };
  }

  const validToMs = Date.parse(validTo);
  const today = dayStart(now);
  const windowDays = Number.isFinite(policy.renewalWindowDays) ? Math.max(0, policy.renewalWindowDays) : 0;
  const opensAtMs = validToMs - windowDays * DAY_MS;
  const opensAt = toIsoDate(opensAtMs);

  if (today > validToMs) {
    return {
      state: "expired",
      validTo,
      opensAt,
      reason: `This expired on ${validTo}. Renewal is no longer available — please submit a new application.`,
    };
  }
  if (today < opensAtMs) {
    return {
      state: "too_early",
      validTo,
      opensAt,
      reason: `Renewal opens on ${opensAt}, ${windowDays} days before this expires on ${validTo}.`,
    };
  }
  return {
    state: "open",
    validTo,
    opensAt,
    reason: `Renewal is open until ${validTo}.`,
  };
}

/** Convenience for callers that only need a yes/no. */
export function canRenew(policy: RenewalPolicy, issuedAt: Date, now: Date): boolean {
  return renewalEligibility(policy, issuedAt, now).state === "open";
}

/**
 * Fields a renewal form carries over from the parent application (BRD: "lighter
 * form prefilled").
 *
 * Answers that describe *what is being licensed* carry over; answers that
 * describe *this application event* must be re-entered, otherwise a renewal
 * silently reasserts last year's declaration — dates, uploaded evidence and any
 * explicitly excluded field.
 */
export function renewalPrefill(
  parentFormData: Record<string, unknown>,
  opts: { excludeApiNames?: readonly string[]; documentApiNames?: readonly string[] } = {},
): Record<string, unknown> {
  const exclude = new Set(opts.excludeApiNames ?? []);
  for (const d of opts.documentApiNames ?? []) exclude.add(d);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parentFormData ?? {})) {
    if (exclude.has(key)) continue;
    // Date answers are point-in-time facts about the previous application.
    if (/date$/i.test(key)) continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * measurement/domain.ts — XS-003 attribution + attach rate + uplift. PURE.
 *
 * ── Why basis points, and why not money ─────────────────────────────────────────
 * Attach rate and uplift are RATIOS, not money, so the bigint-minor-units rule does
 * not apply to them. They are still reported as INTEGER BASIS POINTS (1 bps =
 * 0.01%, 10000 bps = 100%) rather than a float, for three reasons:
 *
 *   1. A binary float cannot hold 0.1 exactly, so two runs that should agree can
 *      differ in the last digit and a dashboard shows a "change" that is not one.
 *   2. Every ratio here is a quotient of two integer counts, so an exact integer
 *      representation is available: round((numerator * 10000) / denominator).
 *      The numerator stays an integer, so precision is exact to 2^53 — far beyond
 *      any realistic subject count.
 *   3. bps is already the unit the rest of this service uses for configuration
 *      weights, so one scale covers the whole cross-sell path.
 *
 * Rounding is half-up on the final integer, applied ONCE. Intermediate values are
 * never rounded, so a rate is never rounded twice.
 *
 * ── Zero denominators ──────────────────────────────────────────────────────────
 * A rate whose denominator is zero is UNDEFINED, not zero. Reporting 0% for "we
 * have not run the experiment on anyone yet" is a lie that reads as a failure.
 * Every such metric returns null plus a note saying why, and NOTHING here ever
 * divides by a value it has not first proved to be non-zero.
 */
import type { AttributionModel, Cohort } from "./schema.js";

/** Denominator of a ratio expressed in basis points. */
export const BPS_SCALE = 10_000;

/** Maximum lookback a caller may ask for when attributing an outcome. */
export const MAX_LOOKBACK_DAYS = 365;

const MS_PER_DAY = 86_400_000;

// ── attribution ───────────────────────────────────────────────────────────────

/** One recommendation that was served to the subject before the outcome. */
export interface ServedTouch {
  recommendationId: string;
  productId?: string | null | undefined;
  servedAt: string | Date;
}

export interface AttributeOutcomeInput {
  touches: readonly ServedTouch[];
  model: AttributionModel;
  outcomeAt: Date;
  /** Only touches this recently may take credit. */
  lookbackDays: number;
  /**
   * When supplied, only touches recommending this product may take credit.
   * Cross-product credit is a real modelling choice, so it is the caller's to
   * make — but the default (no productId) is deliberately the permissive one,
   * because plenty of outcomes have no single product.
   */
  productId?: string | null | undefined;
}

export interface AttributedTouch {
  recommendationId: string;
  servedAt: string;
  /** How long before the outcome the credited recommendation was served. */
  ageDays: number;
}

function touchMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Pick the recommendation that gets credit for an outcome, or null when none
 * qualifies.
 *
 * Eligibility, all of which must hold:
 *   - the touch was served at or BEFORE the outcome. A recommendation served
 *     afterwards cannot have caused it, and crediting it would manufacture
 *     attach rate out of ordinary browsing.
 *   - the touch is within `lookbackDays` of the outcome (inclusive at the
 *     boundary: a touch exactly `lookbackDays` old still counts).
 *   - if `productId` is supplied, the touch recommended that product.
 *
 * Model:
 *   last_touch  — latest eligible servedAt wins (the usual default: the nudge
 *                 closest to the decision).
 *   first_touch — earliest eligible servedAt wins (credits discovery).
 *
 * Ties on servedAt break on recommendationId ASC, so the choice is total and two
 * recommendations served in the same millisecond cannot produce a different
 * answer on a re-run.
 */
export function attributeOutcome(input: AttributeOutcomeInput): AttributedTouch | null {
  const outcomeMs = input.outcomeAt.getTime();
  if (!Number.isFinite(outcomeMs)) return null;

  const lookbackMs =
    Number.isFinite(input.lookbackDays) && input.lookbackDays >= 0
      ? input.lookbackDays * MS_PER_DAY
      : 0;

  const wantProduct = input.productId ?? null;

  let best: { touch: ServedTouch; ms: number } | null = null;

  for (const touch of input.touches) {
    const ms = touchMs(touch.servedAt);
    if (!Number.isFinite(ms)) continue;
    if (ms > outcomeMs) continue;
    if (outcomeMs - ms > lookbackMs) continue;
    if (wantProduct !== null && (touch.productId ?? null) !== wantProduct) continue;

    if (best === null) {
      best = { touch, ms };
      continue;
    }

    const laterWins = input.model === "last_touch";
    if (ms === best.ms) {
      if (touch.recommendationId < best.touch.recommendationId) best = { touch, ms };
      continue;
    }
    if (laterWins ? ms > best.ms : ms < best.ms) best = { touch, ms };
  }

  if (best === null) return null;

  return {
    recommendationId: best.touch.recommendationId,
    servedAt: new Date(best.ms).toISOString(),
    ageDays: Math.round(((outcomeMs - best.ms) / MS_PER_DAY) * 100) / 100,
  };
}

// ── attach rate ───────────────────────────────────────────────────────────────

/** Raw counts for one cohort, as read from the database. */
export interface CohortTally {
  /** Subjects assigned to the cohort — the denominator. */
  exposed: number;
  /** Subjects in the cohort with at least one attributed outcome — the numerator. */
  converted: number;
  /** Total attributed value in minor units. bigint: money never becomes a number. */
  attributedAmountMinor: bigint;
}

export interface AttachRateMetric {
  cohort: Cohort;
  exposed: number;
  converted: number;
  /** converted / exposed, in basis points. NULL when the cohort is empty. */
  attachRateBps: number | null;
  /** MONEY — minor units as a string. */
  attributedAmountMinor: string;
  /** MONEY — mean value per converted subject. NULL when nothing converted. */
  averageValuePerConversionMinor: string | null;
  /** Populated when a metric could not be computed, so callers show a cause. */
  notes: string[];
}

/**
 * Exact integer basis points for count/total, or null when total is zero.
 *
 * The multiply happens BEFORE the divide so the numerator is an exact integer and
 * only one rounding step exists. The zero check is unconditional and comes first:
 * this function is the only place a ratio is formed, so guarding here guards
 * every metric below.
 */
export function ratioToBps(count: number, total: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(total)) return null;
  if (total <= 0) return null;
  return Math.round((count * BPS_SCALE) / total);
}

/** bigint mean, truncated toward zero (a fraction of a paisa is not payable). */
function meanMinor(total: bigint, count: number): string | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  return (total / BigInt(count)).toString();
}

export function computeAttachRate(cohort: Cohort, tally: CohortTally): AttachRateMetric {
  const notes: string[] = [];

  const attachRateBps = ratioToBps(tally.converted, tally.exposed);
  if (attachRateBps === null) {
    notes.push(`${cohort} cohort has no exposures: attach rate is undefined, not zero`);
  }

  const averageValuePerConversionMinor = meanMinor(tally.attributedAmountMinor, tally.converted);
  if (averageValuePerConversionMinor === null) {
    notes.push(`${cohort} cohort has no conversions: average value is undefined`);
  }

  return {
    cohort,
    exposed: tally.exposed,
    converted: tally.converted,
    attachRateBps,
    attributedAmountMinor: tally.attributedAmountMinor.toString(),
    averageValuePerConversionMinor,
    notes,
  };
}

// ── uplift ────────────────────────────────────────────────────────────────────

export interface UpliftMetric {
  treatment: AttachRateMetric;
  control: AttachRateMetric;
  /**
   * treatmentBps − controlBps: percentage POINTS of extra attach, in bps.
   * NULL when either cohort is empty. Can be negative — a cross-sell campaign
   * that performs worse than the holdout is a real and important result.
   */
  absoluteUpliftBps: number | null;
  /**
   * (treatment − control) / control, in bps. NULL when the control attach rate is
   * zero, because dividing by it is undefined; the absolute uplift still carries
   * the finding in that case.
   *
   * NOT capped at 10000: a campaign that triples the baseline is +20000 bps, and
   * clamping it would hide the size of the win.
   */
  relativeUpliftBps: number | null;
  notes: string[];
}

export function computeUplift(treatment: CohortTally, control: CohortTally): UpliftMetric {
  const t = computeAttachRate("treatment", treatment);
  const c = computeAttachRate("control", control);

  const notes: string[] = [...t.notes, ...c.notes];

  let absoluteUpliftBps: number | null = null;
  let relativeUpliftBps: number | null = null;

  if (t.attachRateBps === null || c.attachRateBps === null) {
    notes.push("uplift is undefined: both cohorts need at least one exposure");
  } else {
    absoluteUpliftBps = t.attachRateBps - c.attachRateBps;

    if (c.attachRateBps === 0) {
      notes.push(
        "control attach rate is zero: relative uplift is undefined; use absoluteUpliftBps",
      );
    } else {
      relativeUpliftBps = Math.round(
        ((t.attachRateBps - c.attachRateBps) * BPS_SCALE) / c.attachRateBps,
      );
    }
  }

  return { treatment: t, control: c, absoluteUpliftBps, relativeUpliftBps, notes };
}

/** Format bps for display without float maths: 1234 → "12.34". */
export function bpsToPercentString(bps: number | null): string | null {
  if (bps === null || !Number.isInteger(bps)) return null;
  const negative = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

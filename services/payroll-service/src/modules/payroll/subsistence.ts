/**
 * FR 53 subsistence allowance for a SUSPENDED employee (pure, no I/O).
 *
 * The bug this closes: hrms-service's payroll-input feed has always flagged a
 * pay-suspended employee (`paySuspended`), but nothing in the payroll-service
 * package read it, so a suspended employee was paid full salary.
 *
 * The rule as implemented (government pay-scale engagements only):
 *
 *  - FR 53(1)(ii)(a), first 90 days: subsistence allowance (SA) = leave
 *    salary on half pay = 50% of basic pay, plus DA on that amount.
 *  - After 90 days the competent authority reviews it and may increase it by
 *    up to 50% of the first-3-months amount (=> 75% of basic) or decrease it
 *    by up to 50% (=> 25% of basic). If HRMS records a revised percentage
 *    (migration 0168 review order) it applies from the later of day 91 and
 *    the order's effective date. With no order recorded the SA stays at the
 *    initial rate and the run raises REVIEW_ORDER_DUE for HR.
 *  - FR 53(1)(ii)(b): compensatory allowances (HRA, CCA) continue on the pay
 *    drawn on the date of suspension, i.e. unchanged for the whole month.
 *    Every OTHER structure earning (transport, special pay, ...) stops for the
 *    suspended days. VERIFY against FR 53 / Swamy's: FR 53(1)(ii)(b) makes
 *    other compensatory allowances conditional on the authority being
 *    satisfied the expenditure continues; we take the conservative reading
 *    and pay only HRA/CCA automatically.
 *  - FR 53(2)(ii): no GPF subscription from the SA. The pension wage base
 *    (GPF/NPS/EPF) is therefore the regular days' Basic + DA only. VERIFY
 *    against FR 53 / Swamy's and the CCS (NPS) / EPF rules for NPS and EPF
 *    members: we apply the same "no contribution on SA" reading to all three.
 *  - FR 53(2)(i): income tax, house-rent recovery and Government loan
 *    recovery remain compulsory, so TDS, PT, structure deductions and loan
 *    EMI are left exactly as for any other slip.
 *
 * Every percentage is tenant-configurable (payroll.payroll_settings,
 * migration 0057); the defaults are FR 53's own numbers.
 *
 * Non-government engagements (contract / consolidated / CTC pay): FR 53 does
 * not apply. The whole month is WITHHELD (no slip) and the run flags the
 * employee for HR (NON_GOVERNMENT_ENGAGEMENT_WITHHELD). The same fail-closed
 * treatment applies if the feed flags a suspension but carries no dates
 * (SUSPENSION_DETAILS_MISSING), so a partial HRMS deploy can never fall
 * back to paying full salary.
 *
 * Money is bigint paise throughout; every line is rounded to whole rupees
 * with the same roundRupee() computeSlip uses.
 */
import { roundRupee, hraSlabPct, rawComponentAmountMinor } from "./domain.js";
import type { CityClass, EarningsOverride, PayComponent, RawComponent } from "./domain.js";

export interface SubsistenceConfig {
  /** First-period SA rate, basis points of basic (5000 = 50%). */
  initialPctBps: bigint;
  /** Length of the first period in days (FR 53: 3 months, taken as 90 days). */
  reviewAfterDays: number;
  /** A recorded review order is applied only inside [min, max] (FR 53: 25%..75%). */
  revisedMinPctBps: bigint;
  revisedMaxPctBps: bigint;
}

export const DEFAULT_SUBSISTENCE_CONFIG: SubsistenceConfig = {
  initialPctBps: 5000n,
  reviewAfterDays: 90,
  revisedMinPctBps: 2500n,
  revisedMaxPctBps: 7500n,
};

/** Optional FR 53 fields of a payroll-settings update (PUT /v1/payroll/settings). */
export interface SubsistenceSettingsPatch {
  subsistenceInitialPctBps?: number | undefined;
  subsistenceReviewAfterDays?: number | undefined;
  subsistenceRevisedMinPctBps?: number | undefined;
  subsistenceRevisedMaxPctBps?: number | undefined;
}

/**
 * Apply a partial settings update to the stored FR 53 config and validate the
 * MERGED result (review fix: a lone min=8000 against a stored max=7500 used to
 * be accepted with 202 and then fail the DB CHECK asynchronously). Same rules
 * as migration 0057's payroll_settings_subsistence_check.
 */
export function mergeSubsistenceSettings(
  stored: SubsistenceConfig,
  patch: SubsistenceSettingsPatch,
): { ok: true; config: SubsistenceConfig } | { ok: false; message: string } {
  const config: SubsistenceConfig = {
    initialPctBps: patch.subsistenceInitialPctBps != null ? BigInt(patch.subsistenceInitialPctBps) : stored.initialPctBps,
    reviewAfterDays: patch.subsistenceReviewAfterDays ?? stored.reviewAfterDays,
    revisedMinPctBps: patch.subsistenceRevisedMinPctBps != null ? BigInt(patch.subsistenceRevisedMinPctBps) : stored.revisedMinPctBps,
    revisedMaxPctBps: patch.subsistenceRevisedMaxPctBps != null ? BigInt(patch.subsistenceRevisedMaxPctBps) : stored.revisedMaxPctBps,
  };
  const inBps = (v: bigint) => v >= 0n && v <= 10_000n;
  if (!inBps(config.initialPctBps) || !inBps(config.revisedMinPctBps) || !inBps(config.revisedMaxPctBps)) {
    return { ok: false, message: "subsistence percentages must be between 0 and 10000 basis points" };
  }
  if (!Number.isInteger(config.reviewAfterDays) || config.reviewAfterDays < 1 || config.reviewAfterDays > 366) {
    return { ok: false, message: "subsistenceReviewAfterDays must be between 1 and 366" };
  }
  if (config.revisedMinPctBps > config.revisedMaxPctBps) {
    return {
      ok: false,
      message: `subsistence revised band would be min ${config.revisedMinPctBps} > max ${config.revisedMaxPctBps} basis points (after applying this update to the stored values)`,
    };
  }
  return { ok: true, config };
}

/** The HRMS suspension window + review order, as validated at the feed boundary. */
export interface SuspensionWindow {
  suspensionId: string;
  fromDate: string;              // YYYY-MM-DD, first day of suspension
  toDate: string | null;         // YYYY-MM-DD, last day (null = open-ended)
  revisedPct: number | null;     // review-order percentage of basic, e.g. 75
  revisedEffectiveFrom: string | null;
  reviewOrderRef: string | null;
}

export type SuspensionFlag =
  /** Suspension is past the first period with no (applicable) review order. */
  | "REVIEW_ORDER_DUE"
  /** A review order is recorded but its % is outside the tenant's FR 53 band; not applied. */
  | "REVISED_PCT_OUT_OF_RANGE"
  /** HRMS's creation-time subsistence % differs from the configured FR 53 initial rate; the configured rate was used. */
  | "RECORDED_INITIAL_PCT_IGNORED"
  /** Contract / consolidated / CTC engagement: FR 53 not applied, whole month withheld. */
  | "NON_GOVERNMENT_ENGAGEMENT_WITHHELD"
  /** Feed flagged a pay-suspension without its dates: whole month withheld. */
  | "SUSPENSION_DETAILS_MISSING";

export interface SubsistencePlan {
  daysInMonth: number;
  /** Days of the month outside the suspension window (paid as normal). */
  regularDays: number;
  /** Suspended days, grouped by the SA rate that applies to them. */
  segments: Array<{ pctBps: bigint; days: number }>;
  subsistenceDays: number;
  /** The review-order rate actually applied this month, if any. */
  revisedPctBps: bigint | null;
  flags: SuspensionFlag[];
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function daysInRunMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

/** Percentage (two decimals) -> basis points, e.g. 75 -> 7500n, 33.33 -> 3333n. */
export function pctToBps(pct: number): bigint {
  return BigInt(Math.round(pct * 100));
}

/**
 * Split the run month into regular days and suspended days per SA rate.
 * Day numbering: the suspension's fromDate is day 1, so with the default
 * config days 1..90 are at the initial rate and day 91 onward is the review
 * period.
 */
export function planSubsistence(
  month: string,
  w: SuspensionWindow,
  cfg: SubsistenceConfig = DEFAULT_SUBSISTENCE_CONFIG,
  recordedInitialPct?: number | null,
): SubsistencePlan {
  const daysInMonth = daysInRunMonth(month);
  const flags = new Set<SuspensionFlag>();
  if (recordedInitialPct != null && pctToBps(recordedInitialPct) !== cfg.initialPctBps) {
    flags.add("RECORDED_INITIAL_PCT_IGNORED");
  }

  let revisedBps: bigint | null = null;
  if (w.revisedPct != null) {
    const bps = pctToBps(w.revisedPct);
    if (bps >= cfg.revisedMinPctBps && bps <= cfg.revisedMaxPctBps) revisedBps = bps;
    else flags.add("REVISED_PCT_OUT_OF_RANGE");
  }

  const from = utcDay(w.fromDate);
  const to = w.toDate ? utcDay(w.toDate) : null;
  // Zero-based day index (fromDate = 0) at which the review period starts,
  // and at which the revised rate takes over.
  const reviewIdx = cfg.reviewAfterDays;
  const revisedIdx = revisedBps == null
    ? Number.POSITIVE_INFINITY
    : Math.max(reviewIdx, w.revisedEffectiveFrom ? Math.round((utcDay(w.revisedEffectiveFrom) - from) / DAY_MS) : reviewIdx);

  let regularDays = 0;
  let usedRevised = false;
  const byRate = new Map<bigint, number>();
  const monthStart = utcDay(`${month}-01`);
  for (let d = 0; d < daysInMonth; d++) {
    const day = monthStart + d * DAY_MS;
    if (day < from || (to != null && day > to)) { regularDays++; continue; }
    const idx = Math.round((day - from) / DAY_MS);
    let rate: bigint;
    if (idx < reviewIdx) rate = cfg.initialPctBps;
    else if (idx >= revisedIdx) { rate = revisedBps!; usedRevised = true; }
    else {
      rate = cfg.initialPctBps;
      // Past the first period and no applicable order yet. A valid order
      // with a later effective date is a recorded decision, not a gap.
      if (revisedBps == null) flags.add("REVIEW_ORDER_DUE");
    }
    byRate.set(rate, (byRate.get(rate) ?? 0) + 1);
  }
  const segments = [...byRate.entries()].map(([pctBps, days]) => ({ pctBps, days }));
  const subsistenceDays = daysInMonth - regularDays;
  return {
    daysInMonth, regularDays, segments, subsistenceDays,
    revisedPctBps: usedRevised ? revisedBps : null,
    flags: [...flags],
  };
}

/**
 * Structure earnings that continue during suspension on the pre-suspension
 * pay (FR 53(1)(ii)(b) compensatory allowances). HRA is computed separately
 * (city-class slab); this covers the structure-configured ones.
 * VERIFY against FR 53 / Swamy's before adding any other code here.
 */
export const CONTINUING_ALLOWANCE_CODES: ReadonlySet<string> = new Set(["CCA"]);

export interface SubsistenceEarnings extends EarningsOverride {
  /** Regular-days basic actually paid (persisted as the slip's basic_minor). */
  regularBasicMinor: bigint;
  regularDaMinor: bigint;
  subsistenceMinor: bigint;
  subsistenceDaMinor: bigint;
}

/**
 * Pay lines for a suspended pay-scale employee. Regular days are paid pro
 * rata (Basic, DA, other structure earnings), suspended days earn the
 * Subsistence Allowance + DA on it, HRA/CCA continue in full, and structure
 * DEDUCTIONS are untouched (FR 53(2)(i) compulsory deductions).
 */
export function computeSubsistenceEarnings(input: {
  basicMinor: bigint;
  daRateBps: bigint;
  cityClass: CityClass;
  rawComponents: RawComponent[];
  plan: SubsistencePlan;
}): SubsistenceEarnings {
  const { basicMinor, daRateBps, cityClass, rawComponents, plan } = input;
  const dim = BigInt(plan.daysInMonth);
  const reg = BigInt(plan.regularDays);

  const regularBasicMinor = roundRupee((basicMinor * reg) / dim);
  const regularDaMinor = roundRupee((basicMinor * reg * daRateBps) / (dim * 10_000n));
  // HRA on the pay drawn before suspension, for the whole month -- identical
  // to computeSlip's own HRA line for a non-suspended month.
  const hraMinor = roundRupee((basicMinor * hraSlabPct(cityClass, daRateBps)) / 100n);

  // Sum of basic x days x rate over every suspended segment, divided once at
  // the end so mixed-rate months round only once.
  const saNumerator = plan.segments.reduce((s, seg) => s + basicMinor * BigInt(seg.days) * seg.pctBps, 0n);
  const subsistenceMinor = roundRupee(saNumerator / (dim * 10_000n));
  const subsistenceDaMinor = roundRupee((saNumerator * daRateBps) / (dim * 10_000n * 10_000n));

  const components: PayComponent[] = [];
  if (regularBasicMinor > 0n) components.push({ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: regularBasicMinor });
  if (regularDaMinor > 0n) components.push({ code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: regularDaMinor });
  if (hraMinor > 0n) components.push({ code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: hraMinor });
  if (subsistenceMinor > 0n) {
    components.push({ code: "SUBSISTENCE_ALLOWANCE", name: "Subsistence Allowance", type: "earning", amountMinor: subsistenceMinor });
  }
  if (subsistenceDaMinor > 0n) {
    components.push({ code: "SA_DA", name: "Dearness Allowance on Subsistence Allowance", type: "earning", amountMinor: subsistenceDaMinor });
  }
  for (const c of rawComponents) {
    if (["BASIC", "DA", "HRA"].includes(c.code)) continue;
    const full = rawComponentAmountMinor(basicMinor, c);
    const amt = c.type === "deduction" || CONTINUING_ALLOWANCE_CODES.has(c.code)
      ? full
      : roundRupee((full * reg) / dim);
    if (amt === 0n) continue;
    components.push({ code: c.code, name: c.name, type: c.type, amountMinor: amt });
  }

  return {
    components,
    daMinor: regularDaMinor + subsistenceDaMinor,
    hraMinor,
    pensionBaseMinor: regularBasicMinor + regularDaMinor,
    hraSalaryMinor: regularBasicMinor + regularDaMinor + subsistenceMinor + subsistenceDaMinor,
    regularBasicMinor,
    regularDaMinor,
    subsistenceMinor,
    subsistenceDaMinor,
  };
}

/** Engagement types that are contracts even when their pay mode reads "monthly". */
const CONTRACT_ENGAGEMENT_TYPES: ReadonlySet<string> = new Set(["contract", "contractual"]);

/**
 * Is FR 53 the right rule for this employee? Only the government pay-scale
 * model (HRMS engagement payMode "monthly", i.e. the pay_scale category and
 * legacy permanent/temporary/deputation types). A missing payMode (an older
 * HRMS feed) is NOT assumed to be pay-scale: the caller withholds and flags.
 */
export function isGovernmentPayScale(emp: { payMode?: string | null; engagementType?: string | null }): boolean {
  if ((emp.payMode ?? "").toLowerCase() !== "monthly") return false;
  return !CONTRACT_ENGAGEMENT_TYPES.has((emp.engagementType ?? "").toLowerCase());
}

export type SuspensionTreatment =
  | { kind: "none" }
  | { kind: "withhold"; plan: SubsistencePlan | null; flags: SuspensionFlag[] }
  | { kind: "subsistence"; plan: SubsistencePlan };

/**
 * How the run treats one feed employee. "none" for anyone not pay-suspended
 * and for a suspension that does not touch this month (e.g. it starts next
 * month) -- that employee goes down the regular path untouched.
 */
export function resolveSuspensionTreatment(
  emp: { paySuspended?: boolean; subsistencePct?: number; suspension?: FeedSuspension; payMode?: string; engagementType?: string | null },
  month: string,
  cfg: SubsistenceConfig,
): SuspensionTreatment {
  if (emp.paySuspended !== true) return { kind: "none" };
  if (!emp.suspension) return { kind: "withhold", plan: null, flags: ["SUSPENSION_DETAILS_MISSING"] };
  const plan = planSubsistence(month, toSuspensionWindow(emp.suspension), cfg, emp.subsistencePct ?? null);
  if (plan.subsistenceDays === 0) return { kind: "none" };
  if (!isGovernmentPayScale(emp)) {
    return { kind: "withhold", plan, flags: ["NON_GOVERNMENT_ENGAGEMENT_WITHHELD"] };
  }
  return { kind: "subsistence", plan };
}

/** The payroll-input feed's suspension object (validated in hrms-client.ts). */
export interface FeedSuspension {
  suspensionId: string; fromDate: string; toDate: string | null;
  revisedSubsistencePct: number | null; revisedEffectiveFrom: string | null; reviewOrderRef: string | null;
}

/** Feed shape -> SuspensionWindow (the feed names the revised % revisedSubsistencePct). */
export function toSuspensionWindow(s: FeedSuspension): SuspensionWindow {
  return {
    suspensionId: s.suspensionId, fromDate: s.fromDate, toDate: s.toDate,
    revisedPct: s.revisedSubsistencePct, revisedEffectiveFrom: s.revisedEffectiveFrom, reviewOrderRef: s.reviewOrderRef,
  };
}

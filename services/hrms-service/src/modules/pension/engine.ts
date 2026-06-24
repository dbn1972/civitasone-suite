/**
 * CCS (Pension) Rules — pure computation engine. No DB, no I/O.
 *
 * All money is in PAISE (bigint minor units). Inputs that are monthly amounts
 * (basic, DA) are paise/month. Outputs are paise.
 *
 * References (Central Civil Services Pension Rules, pre-NPS / GPF "old" scheme):
 *  - Qualifying service counted in completed 6-month half-years, capped at
 *    66 half-years (33 years).
 *  - Average emoluments = average of last 10 months (Basic + DA). Where a
 *    10-month history is not available we FALL BACK to last-drawn (Basic + DA)
 *    — documented per call via `avgEmolumentsSource`.
 *  - Superannuation pension (CCS (Pension) Rules, 2021, Rule 44 — codifying the
 *    position w.e.f. 01.01.2006): a minimum of 10 years' qualifying service is
 *    required to earn a pension. Once that floor is met, the pension is a FLAT
 *    50% of average emoluments (or last-drawn, whichever beneficial)
 *    IRRESPECTIVE of the length of qualifying service beyond 10 years. The
 *    pre-2006 linear "proportionate reduction" below 20/33 years was ABOLISHED
 *    w.e.f. 01.01.2006 and is therefore NOT applied here. Below 10 years there
 *    is no superannuation pension (only service gratuity, out of scope here).
 *    NOTE: half-years are still capped at 66 (33 yrs) for DCRG; the cap no
 *    longer affects the pension fraction, which is flat 50%.
 *  - Commutation: up to 40% of pension is commutable. Commuted value =
 *    commuted_monthly_pension * 12 * commutationFactor(age next birthday).
 *    Restored after 15 years.
 *  - DCRG = 1/4 * emoluments(Basic+DA) * completed_half_years, capped at
 *    16.5 * emoluments AND at Rs 20,00,000.
 *  - Family pension = 30% of last Basic (normal); enhanced rate = 50% of last
 *    Basic for the first 7 years from death or up to age 67, whichever earlier.
 *  - NPS / EPF: no defined-benefit pension from this engine.
 */

export const MAX_QUALIFYING_HALF_YEARS = 66; // 33 years (DCRG cap only)
export const MIN_PENSION_QUALIFYING_HALF_YEARS = 20; // 10 years — pension floor (CCS Pension Rules 2021, Rule 44)
export const FULL_PENSION_FRACTION = 0.5; // 50% of average emoluments (flat, irrespective of length once >= 10 yrs)
export const MAX_COMMUTABLE_PCT = 40; // up to 40% commutable
export const DCRG_HALF_YEAR_FACTOR = 0.25; // 1/4 per half-year
export const DCRG_EMOLUMENT_CAP_MULTIPLE = 16.5; // 16.5 x emoluments
export const DCRG_ABSOLUTE_CAP_MINOR = 2_000_000_00n; // Rs 20,00,000 in paise
export const FAMILY_PENSION_NORMAL_PCT = 30; // 30% of last basic
export const FAMILY_PENSION_ENHANCED_PCT = 50; // 50% of last basic (enhanced)
export const FAMILY_PENSION_ENHANCED_MAX_YEARS = 7; // first 7 years
export const FAMILY_PENSION_ENHANCED_MAX_AGE = 67; // or up to age 67
export const COMMUTATION_RESTORE_YEARS = 15;

/**
 * Commutation factors by AGE NEXT BIRTHDAY (Civil Pensions (Commutation) table,
 * as revised w.e.f. 2008). Common retirement ages provided; nearest age used
 * if exact age is absent.
 */
export const COMMUTATION_FACTORS: Readonly<Record<number, number>> = Object.freeze({
  41: 9.075, 42: 9.059, 43: 9.040, 44: 9.019, 45: 8.996,
  46: 8.971, 47: 8.943, 48: 8.913, 49: 8.881, 50: 8.846,
  51: 8.808, 52: 8.768, 53: 8.724, 54: 8.678, 55: 8.627,
  56: 8.572, 57: 8.512, 58: 8.446, 59: 8.371, 60: 8.287,
  61: 8.194, 62: 8.093, 63: 7.982, 64: 7.862, 65: 7.731,
  66: 7.591, 67: 7.431, 68: 7.262, 69: 7.083, 70: 6.897,
});

/** Returns the commutation factor for the given age-next-birthday (nearest tabulated age). */
export function commutationFactor(ageNextBirthday: number): number {
  const exact = COMMUTATION_FACTORS[ageNextBirthday];
  if (exact !== undefined) return exact;
  const ages = Object.keys(COMMUTATION_FACTORS).map(Number);
  let nearest = ages[0]!;
  for (const a of ages) {
    if (Math.abs(a - ageNextBirthday) < Math.abs(nearest - ageNextBirthday)) nearest = a;
  }
  return COMMUTATION_FACTORS[nearest]!;
}

/** Completed whole years between two ISO dates (date2 - date1). */
function diffYears(fromISO: string, toISO: string): { totalMonths: number } {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return { totalMonths: Math.max(0, months) };
}

/**
 * Non-qualifying service spell recorded in the service book.
 *
 * `entryType` identifies a category of service that does NOT count toward
 * qualifying service for pension/DCRG under CCS (Pension) Rules:
 *   - dies_non                 : a "dies non" day (treated as not on duty)
 *   - eol_without_qs           : Extraordinary Leave NOT counting as QS
 *   - suspension_non_duty      : a suspension period treated as non-duty (not
 *                                later regularised as duty)
 *   - boy_service / temporary_service : break-of-service / temporary (non-
 *                                pensionable) service prior to regular service
 *
 * The spell LENGTH is read from the free-text `description` using one of two
 * conventions (case-insensitive, first match wins):
 *   - "days=<n>"                         e.g. "EOL not counting QS; days=180"
 *   - "from=YYYY-MM-DD;to=YYYY-MM-DD"    inclusive span in days
 * Entries without a parseable length contribute zero (and are reported as
 * `unparsed`), so a malformed record can never silently inflate pension.
 */
export const NON_QUALIFYING_ENTRY_TYPES: ReadonlySet<string> = new Set([
  "dies_non",
  "eol_without_qs",
  "suspension_non_duty",
  "boy_service",
  "temporary_service",
]);

export interface ServiceBookEvent {
  entryType: string;
  effectiveDate: string;
  description: string;
}

/** Parse the day-length of a non-qualifying spell from its description. */
export function parseNonQualifyingDays(description: string): number | null {
  const d = (description ?? "").toLowerCase();
  const daysMatch = d.match(/days\s*=\s*(\d+)/);
  if (daysMatch) return Math.max(0, parseInt(daysMatch[1]!, 10));
  const rangeMatch = d.match(/from\s*=\s*(\d{4}-\d{2}-\d{2})\s*;?\s*to\s*=\s*(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) {
    const from = Date.parse(rangeMatch[1]!);
    const to = Date.parse(rangeMatch[2]!);
    if (!Number.isNaN(from) && !Number.isNaN(to) && to >= from) {
      return Math.round((to - from) / 86_400_000) + 1; // inclusive
    }
  }
  return null;
}

export interface NonQualifyingSummary {
  totalDays: number;
  counted: Array<{ entryType: string; effectiveDate: string; days: number }>;
  unparsed: Array<{ entryType: string; effectiveDate: string }>;
}

/** Sum all non-qualifying spell days from service-book events. */
export function summariseNonQualifying(events: readonly ServiceBookEvent[]): NonQualifyingSummary {
  const counted: NonQualifyingSummary["counted"] = [];
  const unparsed: NonQualifyingSummary["unparsed"] = [];
  let totalDays = 0;
  for (const e of events) {
    if (!NON_QUALIFYING_ENTRY_TYPES.has(e.entryType)) continue;
    const days = parseNonQualifyingDays(e.description);
    if (days === null) {
      unparsed.push({ entryType: e.entryType, effectiveDate: e.effectiveDate });
      continue;
    }
    totalDays += days;
    counted.push({ entryType: e.entryType, effectiveDate: e.effectiveDate, days });
  }
  return { totalDays, counted, unparsed };
}

/** Qualifying service in completed half-years (capped) plus a years view. */
export function qualifyingService(
  dateOfJoining: string,
  retirementDate: string,
  nonQualifyingDays = 0,
): { totalMonths: number; grossMonths: number; nonQualifyingDays: number; halfYears: number; years: number } {
  const { totalMonths: grossMonths } = diffYears(dateOfJoining, retirementDate);
  // Net out non-qualifying spells. ~30.4375 days/month (avg) keeps half-year
  // boundaries honest; a 6-month (≈183-day) EOL nets ~6 months => 1 half-year.
  const deductedMonths = Math.floor(Math.max(0, nonQualifyingDays) / 30.4375);
  const totalMonths = Math.max(0, grossMonths - deductedMonths);
  const halfYears = Math.min(Math.floor(totalMonths / 6), MAX_QUALIFYING_HALF_YEARS);
  return {
    totalMonths,
    grossMonths,
    nonQualifyingDays: Math.max(0, nonQualifyingDays),
    halfYears,
    years: Math.round((totalMonths / 12) * 100) / 100,
  };
}

/** Age (in whole years) at a date, plus age next birthday. */
export function ageAt(dateOfBirth: string, atISO: string): { age: number; ageNextBirthday: number } {
  const { totalMonths } = diffYears(dateOfBirth, atISO);
  const age = Math.floor(totalMonths / 12);
  return { age, ageNextBirthday: age + 1 };
}

/** Helper: round a number to bigint paise (half-up). */
function toPaise(n: number): bigint {
  return BigInt(Math.round(n));
}

export interface PensionInput {
  pensionScheme: string; // GPF | NPS | EPF
  dateOfJoining: string; // ISO
  retirementDate: string; // ISO
  lastBasicMinor: bigint; // paise/month
  daRatePct: number; // e.g. 50 for 50%
  /** Optional explicit last-10-months (Basic+DA) emoluments per month, paise. If absent -> fallback. */
  avgEmolumentsMinor?: bigint;
  /** Date of birth (ISO) — required to derive age next birthday for commutation; optional. */
  dateOfBirth?: string;
  /** Percentage of pension to commute (0..40). Defaults to 40 (max). */
  commutePct?: number;
  /** Age next birthday override (used if dateOfBirth not supplied). Defaults to 61 (retire at 60). */
  ageNextBirthday?: number;
  /** Non-qualifying service days (from the service book) to net out of QS. */
  nonQualifyingDays?: number;
}

export interface PensionResult {
  pensionScheme: string;
  definedBenefit: boolean;
  note?: string;
  qualifying: { totalMonths: number; grossMonths: number; nonQualifyingDays: number; halfYears: number; years: number };
  avgEmolumentsMinor: bigint;
  avgEmolumentsSource: "last_10_months" | "last_drawn_fallback";
  emolumentsBasicPlusDaMinor: bigint; // last-drawn Basic+DA (used for DCRG / commutation base)
  monthlyPensionMinor: bigint;
  fullPensionEligible: boolean;
  /** True when qualifying service >= 10 years (the minimum to earn any pension). */
  pensionEligible: boolean;
  pensionRule: string;
  commutation: {
    commutePct: number;
    ageNextBirthday: number;
    factor: number;
    commutedMonthlyPensionMinor: bigint;
    commutedValueMinor: bigint;
    residualMonthlyPensionMinor: bigint;
    restoreAfterYears: number;
  };
  dcrg: {
    completedHalfYears: number;
    rawMinor: bigint;
    emolumentCapMinor: bigint;
    absoluteCapMinor: bigint;
    payableMinor: bigint;
    cappedBy: "none" | "emolument_multiple" | "absolute_ceiling";
  };
  familyPension: {
    normalMinor: bigint;
    enhancedMinor: bigint;
    enhancedDurationYears: number;
    enhancedNote: string;
  };
}

/**
 * Compute the full CCS pension breakup for an employee.
 * For NPS/EPF returns a clear no-defined-benefit note and zero pension amounts.
 */
export function computePension(input: PensionInput): PensionResult {
  const qualifying = qualifyingService(input.dateOfJoining, input.retirementDate, input.nonQualifyingDays ?? 0);
  const daRate = input.daRatePct / 100;

  // Last-drawn Basic+DA (emoluments base for DCRG and commutation).
  const lastBasic = Number(input.lastBasicMinor);
  const emolumentsBasicPlusDa = toPaise(lastBasic * (1 + daRate));

  if (input.pensionScheme !== "GPF") {
    // NPS / EPF: defined-contribution. No DB pension from this engine.
    return {
      pensionScheme: input.pensionScheme,
      definedBenefit: false,
      note:
        input.pensionScheme === "NPS"
          ? "Employee is on NPS (National Pension System) — a defined-contribution scheme. No defined-benefit pension/DCRG/commutation is computed here; benefits are determined by the accumulated NPS corpus and annuity at exit."
          : "Employee is on EPF — no CCS defined-benefit pension is computed here.",
      qualifying,
      avgEmolumentsMinor: 0n,
      avgEmolumentsSource: "last_drawn_fallback",
      emolumentsBasicPlusDaMinor: emolumentsBasicPlusDa,
      monthlyPensionMinor: 0n,
      fullPensionEligible: false,
      pensionEligible: false,
      pensionRule: "Defined-contribution scheme (NPS/EPF) — CCS defined-benefit pension not applicable.",
      commutation: {
        commutePct: 0, ageNextBirthday: 0, factor: 0,
        commutedMonthlyPensionMinor: 0n, commutedValueMinor: 0n,
        residualMonthlyPensionMinor: 0n, restoreAfterYears: COMMUTATION_RESTORE_YEARS,
      },
      dcrg: {
        completedHalfYears: qualifying.halfYears, rawMinor: 0n,
        emolumentCapMinor: 0n, absoluteCapMinor: DCRG_ABSOLUTE_CAP_MINOR,
        payableMinor: 0n, cappedBy: "none",
      },
      familyPension: {
        normalMinor: 0n, enhancedMinor: 0n, enhancedDurationYears: 0,
        enhancedNote: "Not applicable under NPS/EPF in this engine.",
      },
    };
  }

  // ---- GPF / old defined-benefit pension ----

  // Average emoluments: explicit last-10-months if supplied, else last-drawn fallback.
  const avgEmolumentsSource: PensionResult["avgEmolumentsSource"] =
    input.avgEmolumentsMinor !== undefined ? "last_10_months" : "last_drawn_fallback";
  const avgEmoluments =
    input.avgEmolumentsMinor !== undefined ? Number(input.avgEmolumentsMinor) : lastBasic * (1 + daRate);

  // Superannuation pension — CCS (Pension) Rules, 2021, Rule 44 (position w.e.f.
  // 01.01.2006): a flat 50% of average emoluments once the 10-year qualifying
  // floor is met, IRRESPECTIVE of length of service beyond 10 years. The
  // pre-2006 linear proportionate reduction below 20/33 years is NOT applied.
  // Below 10 years no superannuation pension accrues (service gratuity only,
  // which is out of scope for this engine — pension is reported as zero).
  const pensionEligible = qualifying.halfYears >= MIN_PENSION_QUALIFYING_HALF_YEARS; // >= 10 years
  // `fullPensionEligible` is retained for backward compatibility: under the
  // post-2006 rule full (50%) pension applies the moment the 10-year floor is
  // crossed, so it is now equivalent to `pensionEligible`.
  const fullPensionEligible = pensionEligible;
  const serviceFraction = pensionEligible ? 1 : 0;
  const monthlyPension = toPaise(avgEmoluments * FULL_PENSION_FRACTION * serviceFraction);
  const pensionRule = pensionEligible
    ? "CCS (Pension) Rules 2021, Rule 44: flat 50% of average emoluments (>=10 yrs qualifying service), no proportionate reduction (post-01.01.2006)."
    : "Qualifying service below the 10-year minimum: no superannuation pension; only service gratuity is payable (not computed by this engine).";

  // Commutation.
  let ageNextBirthday = input.ageNextBirthday ?? 61;
  if (input.dateOfBirth) ageNextBirthday = ageAt(input.dateOfBirth, input.retirementDate).ageNextBirthday;
  const commutePct = Math.min(Math.max(input.commutePct ?? MAX_COMMUTABLE_PCT, 0), MAX_COMMUTABLE_PCT);
  const factor = commutationFactor(ageNextBirthday);
  const commutedMonthly = toPaise(Number(monthlyPension) * (commutePct / 100));
  const commutedValue = toPaise(Number(commutedMonthly) * 12 * factor);
  const residualMonthly = monthlyPension - commutedMonthly;

  // DCRG = 1/4 * (Basic+DA) * completed_half_years, capped.
  const dcrgRaw = toPaise(Number(emolumentsBasicPlusDa) * DCRG_HALF_YEAR_FACTOR * qualifying.halfYears);
  const emolumentCap = toPaise(Number(emolumentsBasicPlusDa) * DCRG_EMOLUMENT_CAP_MULTIPLE);
  let dcrgPayable = dcrgRaw;
  let cappedBy: PensionResult["dcrg"]["cappedBy"] = "none";
  if (dcrgPayable > emolumentCap) { dcrgPayable = emolumentCap; cappedBy = "emolument_multiple"; }
  if (dcrgPayable > DCRG_ABSOLUTE_CAP_MINOR) { dcrgPayable = DCRG_ABSOLUTE_CAP_MINOR; cappedBy = "absolute_ceiling"; }

  // Family pension on last Basic.
  const familyNormal = toPaise(lastBasic * (FAMILY_PENSION_NORMAL_PCT / 100));
  const familyEnhanced = toPaise(lastBasic * (FAMILY_PENSION_ENHANCED_PCT / 100));

  return {
    pensionScheme: input.pensionScheme,
    definedBenefit: true,
    qualifying,
    avgEmolumentsMinor: toPaise(avgEmoluments),
    avgEmolumentsSource,
    emolumentsBasicPlusDaMinor: emolumentsBasicPlusDa,
    monthlyPensionMinor: monthlyPension,
    fullPensionEligible,
    pensionEligible,
    pensionRule,
    commutation: {
      commutePct, ageNextBirthday, factor,
      commutedMonthlyPensionMinor: commutedMonthly,
      commutedValueMinor: commutedValue,
      residualMonthlyPensionMinor: residualMonthly,
      restoreAfterYears: COMMUTATION_RESTORE_YEARS,
    },
    dcrg: {
      completedHalfYears: qualifying.halfYears,
      rawMinor: dcrgRaw,
      emolumentCapMinor: emolumentCap,
      absoluteCapMinor: DCRG_ABSOLUTE_CAP_MINOR,
      payableMinor: dcrgPayable,
      cappedBy,
    },
    familyPension: {
      normalMinor: familyNormal,
      enhancedMinor: familyEnhanced,
      enhancedDurationYears: FAMILY_PENSION_ENHANCED_MAX_YEARS,
      enhancedNote: `Enhanced family pension (${FAMILY_PENSION_ENHANCED_PCT}% of last basic) payable for the first ${FAMILY_PENSION_ENHANCED_MAX_YEARS} years from death or up to age ${FAMILY_PENSION_ENHANCED_MAX_AGE}, whichever is earlier; thereafter normal rate (${FAMILY_PENSION_NORMAL_PCT}%).`,
    },
  };
}

/**
 * Earned-Leave (EL) encashment = (Basic+DA)/30 * min(EL_balance, 300) days.
 * Returns paise. Used by separation settlement.
 */
export function elEncashment(lastBasicMinor: bigint, daRatePct: number, elBalanceDays: number): bigint {
  const dailyEmolument = Number(lastBasicMinor) * (1 + daRatePct / 100) / 30;
  const days = Math.min(Math.max(elBalanceDays, 0), 300);
  return toPaise(dailyEmolument * days);
}

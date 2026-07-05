/**
 * Separation tax exemptions per Income-tax Act, 1961.
 *
 * Pure functions — no DB access. All amounts in paise (bigint).
 * Callers pass the statutory ceiling (from exemption_ceilings table) so the
 * engine remains FY-agnostic and future-amendment-safe.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SeparationType =
  | "retirement" | "superannuation" | "resignation"
  | "retrenchment" | "vrs" | "death" | "termination";

export type EmployeeCategory = "govt" | "non_govt_covered" | "non_govt_uncovered";

// ── Gratuity Exemption — Sec 10(10) ─────────────────────────────────────────

export interface GratuityExemptionInput {
  /** Actual gratuity amount received (paise). */
  actualGratuityMinor: bigint;
  /** Last drawn monthly wages = Basic + DA (paise). */
  lastDrawnWagesMinor: bigint;
  /** Completed years of service (6-month rounding already applied). */
  completedYears: number;
  /** Employee classification. */
  employeeCategory: EmployeeCategory;
  /** Statutory ceiling from exemption_ceilings table (paise). */
  ceilingMinor: bigint;
}

export interface GratuityExemptionResult {
  exemptMinor: bigint;
  taxableMinor: bigint;
  section: "10(10)";
  reason: string;
}

/**
 * Sec 10(10): Gratuity exemption.
 * - Govt: fully exempt (no ceiling).
 * - Non-govt covered (PG Act): LEAST(actual, ceiling, 15/26 × lastWages × years).
 * - Non-govt uncovered: LEAST(actual, ceiling, halfMonth × avgSalary × years).
 */
export function computeGratuityExemption(input: GratuityExemptionInput): GratuityExemptionResult {
  const { actualGratuityMinor, lastDrawnWagesMinor, completedYears, employeeCategory, ceilingMinor } = input;

  if (actualGratuityMinor <= 0n) {
    return { exemptMinor: 0n, taxableMinor: 0n, section: "10(10)", reason: "no gratuity payable" };
  }

  // Government employees: entire gratuity exempt, no ceiling
  if (employeeCategory === "govt") {
    return {
      exemptMinor: actualGratuityMinor,
      taxableMinor: 0n,
      section: "10(10)",
      reason: "government employee — fully exempt",
    };
  }

  const years = BigInt(Math.max(0, completedYears));

  // Non-govt covered by Payment of Gratuity Act: 15/26 formula
  // Formula: (lastDrawnWages × 15 × completedYears) / 26
  let formulaMinor: bigint;
  if (employeeCategory === "non_govt_covered") {
    formulaMinor = (lastDrawnWagesMinor * 15n * years) / 26n;
  } else {
    // Non-govt uncovered: half-month average salary × completed years
    formulaMinor = (lastDrawnWagesMinor * years) / 2n;
  }

  const exempt = bigMin(actualGratuityMinor, bigMin(ceilingMinor, formulaMinor));
  const taxable = actualGratuityMinor - exempt;

  return {
    exemptMinor: exempt,
    taxableMinor: taxable < 0n ? 0n : taxable,
    section: "10(10)",
    reason: employeeCategory === "non_govt_covered"
      ? `non-govt (PG Act): exempt=${exempt}, formula=${formulaMinor}, ceiling=${ceilingMinor}`
      : `non-govt (uncovered): exempt=${exempt}, formula=${formulaMinor}, ceiling=${ceilingMinor}`,
  };
}

// ── Leave Encashment Exemption — Sec 10(10AA) ────────────────────────────────

export interface LeaveEncashExemptionInput {
  /** Actual leave encashment received (paise). */
  actualEncashmentMinor: bigint;
  /** Average monthly salary (basic+DA) of last 10 months (paise). */
  avgSalaryLast10MonthsMinor: bigint;
  /** Leave balance days at separation. */
  leaveBalanceDays: number;
  /** Completed years of service. */
  completedYears: number;
  /** Employee classification. */
  employeeCategory: EmployeeCategory;
  /** Separation type — exemption only on retirement/superannuation/death. */
  separationType: SeparationType;
  /** Statutory ceiling from exemption_ceilings table (paise). */
  ceilingMinor: bigint;
  /** Lifetime aggregate already claimed from prior employers (paise). */
  priorExemptionClaimedMinor: bigint;
}

export interface LeaveEncashExemptionResult {
  exemptMinor: bigint;
  taxableMinor: bigint;
  section: "10(10AA)";
  reason: string;
}

/** Separation types that qualify for leave encashment exemption. */
const LEAVE_EXEMPT_SEPARATIONS: ReadonlySet<SeparationType> = new Set([
  "retirement", "superannuation", "death",
]);

/**
 * Sec 10(10AA): Leave encashment on retirement.
 * - Govt: fully exempt.
 * - Non-govt on retirement/superannuation/death: LEAST(actual, ceiling−prior, 10-month avg, cashEquivalent).
 * - Non-govt on resignation: NO exemption.
 */
export function computeLeaveEncashExemption(input: LeaveEncashExemptionInput): LeaveEncashExemptionResult {
  const {
    actualEncashmentMinor, avgSalaryLast10MonthsMinor, leaveBalanceDays,
    completedYears, employeeCategory, separationType, ceilingMinor, priorExemptionClaimedMinor,
  } = input;

  if (actualEncashmentMinor <= 0n) {
    return { exemptMinor: 0n, taxableMinor: 0n, section: "10(10AA)", reason: "no leave encashment payable" };
  }

  // Government: fully exempt on any separation type
  if (employeeCategory === "govt") {
    return {
      exemptMinor: actualEncashmentMinor,
      taxableMinor: 0n,
      section: "10(10AA)",
      reason: "government employee — fully exempt",
    };
  }

  // Non-govt: only exempt on retirement/superannuation/death
  if (!LEAVE_EXEMPT_SEPARATIONS.has(separationType)) {
    return {
      exemptMinor: 0n,
      taxableMinor: actualEncashmentMinor,
      section: "10(10AA)",
      reason: `separation type '${separationType}' does not qualify for Sec 10(10AA) exemption`,
    };
  }

  // Remaining lifetime ceiling after prior claims
  const remainingCeiling = ceilingMinor - priorExemptionClaimedMinor;
  if (remainingCeiling <= 0n) {
    return {
      exemptMinor: 0n,
      taxableMinor: actualEncashmentMinor,
      section: "10(10AA)",
      reason: "lifetime ceiling exhausted by prior employer claims",
    };
  }

  // Limb 1: 10 months' average salary
  const tenMonthsAvgMinor = avgSalaryLast10MonthsMinor * 10n;

  // Limb 2: Cash equivalent of leave balance (max 30 days per year of service)
  const maxLeaveDays = Math.min(leaveBalanceDays, completedYears * 30);
  const dailySalaryMinor = avgSalaryLast10MonthsMinor / 30n;
  const cashEquivalentMinor = dailySalaryMinor * BigInt(maxLeaveDays);

  // LEAST of four limbs
  const exempt = bigMin(
    actualEncashmentMinor,
    bigMin(remainingCeiling, bigMin(tenMonthsAvgMinor, cashEquivalentMinor)),
  );
  const taxable = actualEncashmentMinor - exempt;

  return {
    exemptMinor: exempt,
    taxableMinor: taxable < 0n ? 0n : taxable,
    section: "10(10AA)",
    reason: `retirement: exempt=${exempt}, ceiling remaining=${remainingCeiling}, 10-month avg=${tenMonthsAvgMinor}, cash equiv=${cashEquivalentMinor}`,
  };
}

// ── Retrenchment Compensation — Sec 10(10B) ──────────────────────────────────

export interface RetrenchmentExemptionInput {
  /** Actual retrenchment compensation received (paise). */
  actualCompMinor: bigint;
  /** Average monthly pay for last 3 months (paise). */
  avgMonthlyPayMinor: bigint;
  /** Completed years of service. */
  completedYears: number;
  /** Separation type — must be 'retrenchment'. */
  separationType: SeparationType;
  /** Statutory ceiling (paise). */
  ceilingMinor: bigint;
}

export interface RetrenchmentExemptionResult {
  exemptMinor: bigint;
  taxableMinor: bigint;
  section: "10(10B)";
  reason: string;
}

/**
 * Sec 10(10B): Retrenchment compensation — ID Act formula.
 * Only applicable when separationType === "retrenchment".
 */
export function computeRetrenchmentExemption(input: RetrenchmentExemptionInput): RetrenchmentExemptionResult | null {
  const { actualCompMinor, avgMonthlyPayMinor, completedYears, separationType, ceilingMinor } = input;

  if (separationType !== "retrenchment") return null;
  if (actualCompMinor <= 0n) {
    return { exemptMinor: 0n, taxableMinor: 0n, section: "10(10B)", reason: "no retrenchment compensation" };
  }

  // ID Act formula: 15 days' average pay × completed years
  const formulaMinor = (avgMonthlyPayMinor * 15n * BigInt(completedYears)) / 30n;

  const exempt = bigMin(actualCompMinor, bigMin(ceilingMinor, formulaMinor));
  const taxable = actualCompMinor - exempt;

  return {
    exemptMinor: exempt,
    taxableMinor: taxable < 0n ? 0n : taxable,
    section: "10(10B)",
    reason: `retrenchment: exempt=${exempt}, formula=${formulaMinor}, ceiling=${ceilingMinor}`,
  };
}

// ── VRS Exemption — Sec 10(10C) ──────────────────────────────────────────────

export interface VrsExemptionInput {
  /** Actual VRS compensation received (paise). */
  actualCompMinor: bigint;
  /** Monthly salary at time of retirement (paise). */
  monthlySalaryMinor: bigint;
  /** Completed years of service. */
  completedYears: number;
  /** Remaining months until normal retirement age. */
  remainingMonthsToRetirement: number;
  /** Separation type — must be 'vrs'. */
  separationType: SeparationType;
  /** Statutory ceiling (paise). */
  ceilingMinor: bigint;
}

export interface VrsExemptionResult {
  exemptMinor: bigint;
  taxableMinor: bigint;
  section: "10(10C)";
  reason: string;
}

/**
 * Sec 10(10C): VRS compensation — Rule 2BA.
 * Only applicable when separationType === "vrs".
 */
export function computeVrsExemption(input: VrsExemptionInput): VrsExemptionResult | null {
  const { actualCompMinor, monthlySalaryMinor, completedYears, remainingMonthsToRetirement, separationType, ceilingMinor } = input;

  if (separationType !== "vrs") return null;
  if (actualCompMinor <= 0n) {
    return { exemptMinor: 0n, taxableMinor: 0n, section: "10(10C)", reason: "no VRS compensation" };
  }

  // Limb A: 3 months' salary × completed years
  const limbA = monthlySalaryMinor * 3n * BigInt(completedYears);
  // Limb B: salary × remaining months to normal retirement
  const limbB = monthlySalaryMinor * BigInt(Math.max(0, remainingMonthsToRetirement));

  // Formula = lesser of the two limbs
  const formula = bigMin(limbA, limbB);
  const exempt = bigMin(actualCompMinor, bigMin(ceilingMinor, formula));
  const taxable = actualCompMinor - exempt;

  return {
    exemptMinor: exempt,
    taxableMinor: taxable < 0n ? 0n : taxable,
    section: "10(10C)",
    reason: `VRS: exempt=${exempt}, 3mo×years=${limbA}, salary×remaining=${limbB}, ceiling=${ceilingMinor}`,
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function bigMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

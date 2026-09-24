/**
 * Full & Final Settlement domain — computes separation payments with tax
 * exemptions (Sec 10(10), 10(10AA), 10(10B), 10(10C)) and TDS true-up.
 *
 * Pure function. Receives all inputs, returns the full breakdown. No DB access.
 * All monetary values in paise (bigint).
 */

import {
  computeGratuityExemption,
  computeLeaveEncashExemption,
  computeRetrenchmentExemption,
  computeVrsExemption,
  type SeparationType,
  type EmployeeCategory,
  type GratuityExemptionResult,
  type LeaveEncashExemptionResult,
  type RetrenchmentExemptionResult,
  type VrsExemptionResult,
} from "../tax/exemptions.js";
import { computeTax, stdDeduction, type Regime } from "../tax/engine.js";
import { DEFAULT_STATUTORY_CONFIG, type StatutoryConfig } from "../payroll/domain.js";

export interface FnfInput {
  employeeId: string;
  tenantId: string;
  separationType: SeparationType;
  separationDate: string;
  employeeCategory: EmployeeCategory;
  /**
   * DIC engagement terminal-benefit gates (default true). When an engagement
   * type's policy excludes gratuity or leave-encashment (consultant, third-party,
   * apprentice), the corresponding gross is forced to zero before exemption/tax.
   * Omitting them keeps pre-engagement behaviour.
   */
  eligibleForGratuity?: boolean;
  leaveEncashmentEligible?: boolean;
  // Gross F&F amounts (from hrms-service fnf-calculate)
  noticeBuyoutMinor: bigint;
  leaveEncashmentGrossMinor: bigint;
  gratuityGrossMinor: bigint;
  retrenchmentCompMinor: bigint;
  vrsCompMinor: bigint;
  arrearsMinor: bigint;
  // Inputs for exemption computation
  lastDrawnWagesMinor: bigint;      // monthly basic + DA
  completedYears: number;            // 6-month rounding per PG Act
  avgSalaryLast10MonthsMinor: bigint;
  leaveBalanceDays: number;
  priorLeaveEncashExemptionMinor: bigint;
  // VRS-specific
  remainingMonthsToRetirement: number;
  // Tax context for the FY of separation
  taxRegime: Regime;
  salaryYtdMinor: bigint;          // total salary already paid this FY
  tdsYtdMinor: bigint;             // total TDS already deducted this FY
  deductions80cMinor: bigint;       // Ch VI-A deductions declared (capped at statutoryConfig.sec80cCapMinor)
  deductions80dMinor: bigint;       // capped at statutoryConfig.sec80dCapMinor
  otherDeductionsMinor: bigint;     // no statutory cap — matches the monthly payroll engine
  fyStartYear: number;
  /**
   * Statutory Chapter VI-A caps (Sec 80C, Sec 80D). Optional — defaults to
   * DEFAULT_STATUTORY_CONFIG, exactly mirroring SlipInput.statutoryConfig in
   * payroll/domain.ts, so every existing/omitting caller (fnf/consumer.ts,
   * all current tests) keeps working: the only behaviour change is that
   * declared amounts above the default cap are now clipped instead of
   * silently passing through uncapped.
   */
  statutoryConfig?: StatutoryConfig;
  // Exemption ceilings (loaded from DB)
  gratuityCeilingMinor: bigint;
  leaveEncashCeilingMinor: bigint;
  retrenchmentCeilingMinor: bigint;
  vrsCeilingMinor: bigint;
}

export interface FnfResult {
  gratuityExemption: GratuityExemptionResult;
  leaveEncashExemption: LeaveEncashExemptionResult;
  retrenchmentExemption: RetrenchmentExemptionResult | null;
  vrsExemption: VrsExemptionResult | null;
  // Aggregates
  totalGrossMinor: bigint;
  totalExemptMinor: bigint;
  totalTaxableOnSeparationMinor: bigint;
  // FY-level tax
  annualTaxableMinor: bigint;
  annualTaxMinor: bigint;
  tdsAlreadyDeductedMinor: bigint;
  tdsOnSeparationMinor: bigint;
  netPayableMinor: bigint;
}

/**
 * Compute a full F&F settlement with tax exemptions and TDS true-up.
 *
 * Flow:
 * 1. Compute exemptions for each separation component.
 * 2. Notice buyout and arrears are ALWAYS fully taxable (salary income).
 * 3. Sum taxable portions of all components.
 * 4. Compute annual taxable: salary YTD + taxable separation − deductions.
 * 5. Compute annual tax via existing `computeTax()`.
 * 6. TDS on separation = annual tax − TDS already deducted this FY.
 * 7. Net payable = total gross − TDS on separation.
 */
export function computeFnfSettlement(input: FnfInput): FnfResult {
  // Step 0 (DIC engagement gate): a type whose policy excludes gratuity or
  // leave-encashment (consultant / third-party / apprentice) settles zero for
  // that head. Applied before exemption/tax so nothing downstream can reinstate
  // it. Defaults to eligible, preserving pre-engagement behaviour.
  const gratuityGrossMinor = input.eligibleForGratuity === false ? 0n : input.gratuityGrossMinor;
  const leaveEncashmentGrossMinor = input.leaveEncashmentEligible === false ? 0n : input.leaveEncashmentGrossMinor;
  input = { ...input, gratuityGrossMinor, leaveEncashmentGrossMinor };

  // Step 1: Exemptions
  const gratuityExemption = computeGratuityExemption({
    actualGratuityMinor: input.gratuityGrossMinor,
    lastDrawnWagesMinor: input.lastDrawnWagesMinor,
    completedYears: input.completedYears,
    employeeCategory: input.employeeCategory,
    ceilingMinor: input.gratuityCeilingMinor,
  });

  const leaveEncashExemption = computeLeaveEncashExemption({
    actualEncashmentMinor: input.leaveEncashmentGrossMinor,
    avgSalaryLast10MonthsMinor: input.avgSalaryLast10MonthsMinor,
    leaveBalanceDays: input.leaveBalanceDays,
    completedYears: input.completedYears,
    employeeCategory: input.employeeCategory,
    separationType: input.separationType,
    ceilingMinor: input.leaveEncashCeilingMinor,
    priorExemptionClaimedMinor: input.priorLeaveEncashExemptionMinor,
  });

  const retrenchmentExemption = computeRetrenchmentExemption({
    actualCompMinor: input.retrenchmentCompMinor,
    avgMonthlyPayMinor: input.lastDrawnWagesMinor,
    completedYears: input.completedYears,
    separationType: input.separationType,
    ceilingMinor: input.retrenchmentCeilingMinor,
  });

  const vrsExemption = computeVrsExemption({
    actualCompMinor: input.vrsCompMinor,
    monthlySalaryMinor: input.lastDrawnWagesMinor,
    completedYears: input.completedYears,
    remainingMonthsToRetirement: input.remainingMonthsToRetirement,
    separationType: input.separationType,
    ceilingMinor: input.vrsCeilingMinor,
  });

  // Step 2: Total gross
  const totalGrossMinor =
    input.noticeBuyoutMinor +
    input.leaveEncashmentGrossMinor +
    input.gratuityGrossMinor +
    input.retrenchmentCompMinor +
    input.vrsCompMinor +
    input.arrearsMinor;

  // Step 3: Total exempt
  const totalExemptMinor =
    gratuityExemption.exemptMinor +
    leaveEncashExemption.exemptMinor +
    (retrenchmentExemption?.exemptMinor ?? 0n) +
    (vrsExemption?.exemptMinor ?? 0n);

  // Step 4: Total taxable on separation
  // Notice buyout and arrears are fully taxable (salary income u/s 17(1))
  const totalTaxableOnSeparationMinor =
    input.noticeBuyoutMinor +
    input.arrearsMinor +
    gratuityExemption.taxableMinor +
    leaveEncashExemption.taxableMinor +
    (retrenchmentExemption?.taxableMinor ?? 0n) +
    (vrsExemption?.taxableMinor ?? 0n);

  // Step 5: Annual taxable income for the FY
  const totalSalaryIncomeMinor = input.salaryYtdMinor + totalTaxableOnSeparationMinor;
  // DOM-008 (completing #1117): resolved for this employee's own tenant.
  const stdDed = BigInt(stdDeduction(input.taxRegime, input.fyStartYear, input.tenantId)) * 100n; // convert rupees to paise
  // Chapter VI-A deductions are statutorily capped (Sec 80C, Sec 80D), exactly
  // as the monthly payroll engine caps them (payroll/domain.ts computeSlip,
  // d80c/d80d against statutoryConfig.sec80cCapMinor/sec80dCapMinor). F&F used
  // to sum the raw declared amounts uncapped here, silently under-withholding
  // TDS on separation. otherDeductionsMinor has no statutory cap in the
  // monthly engine either, so it is intentionally left uncapped below.
  const statutoryConfig = input.statutoryConfig ?? DEFAULT_STATUTORY_CONFIG;
  const cappedD80c = input.deductions80cMinor > statutoryConfig.sec80cCapMinor ? statutoryConfig.sec80cCapMinor : input.deductions80cMinor;
  const cappedD80d = input.deductions80dMinor > statutoryConfig.sec80dCapMinor ? statutoryConfig.sec80dCapMinor : input.deductions80dMinor;
  const chapterViA = input.taxRegime === "old"
    ? cappedD80c + cappedD80d + input.otherDeductionsMinor
    : 0n; // New regime: no Ch VI-A deductions

  let annualTaxableMinor = totalSalaryIncomeMinor - stdDed - chapterViA;
  if (annualTaxableMinor < 0n) annualTaxableMinor = 0n;

  // Step 6: Compute annual tax (convert paise to rupees for the engine, then back)
  const taxableRupees = Math.round(Math.max(0, Number(annualTaxableMinor) / 100) / 10) * 10; // Sec 288A rounding
  const taxResult = computeTax(taxableRupees, input.taxRegime, input.fyStartYear, input.tenantId);
  const annualTaxMinor = BigInt(taxResult.totalTax) * 100n;

  // Step 7: TDS on separation = annual tax − YTD TDS
  let tdsOnSeparationMinor = annualTaxMinor - input.tdsYtdMinor;
  if (tdsOnSeparationMinor < 0n) tdsOnSeparationMinor = 0n;

  // Step 8: Net payable = total gross − TDS deducted on F&F
  const netPayableMinor = totalGrossMinor - tdsOnSeparationMinor;

  return {
    gratuityExemption,
    leaveEncashExemption,
    retrenchmentExemption,
    vrsExemption,
    totalGrossMinor,
    totalExemptMinor,
    totalTaxableOnSeparationMinor,
    annualTaxableMinor,
    annualTaxMinor,
    tdsAlreadyDeductedMinor: input.tdsYtdMinor,
    tdsOnSeparationMinor,
    netPayableMinor,
  };
}

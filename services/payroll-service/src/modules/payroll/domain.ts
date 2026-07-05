import { hraExemptionMinor, annualTaxFromTaxableMinor, trueUpTdsMinor, type Regime } from "../tax/engine.js";

/** Employee tax declaration inputs for old-regime exemptions (annual paise). */
export interface TaxDeclarationInput {
  rentPaidAnnualMinor?: bigint;
  ded80cMinor?: bigint;
  ded80dMinor?: bigint;
  otherDedMinor?: bigint;
  /** Previous-employer taxable salary for this FY (Sec 192(2), both regimes). */
  prevEmployerSalaryMinor?: bigint;
  /** Income reported under "income from other sources" (both regimes). */
  otherSourcesIncomeMinor?: bigint;
  /** Perquisites value, Sec 17(2) — added to salary income (both regimes). */
  perquisitesMinor?: bigint;
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface PayComponent {
  code: string;
  name: string;
  type: "earning" | "deduction";
  amountMinor: bigint;
}

/** Raw structure component as configured (fixed amount OR percentage of basic). */
export interface RawComponent {
  code: string;
  name: string;
  type: "earning" | "deduction";
  fixedMinor?: bigint | null;
  pctOfBasic?: number | null; // e.g. 10 => 10% of basic
}

export type PensionScheme = "GPF" | "NPS" | "EPF";
export type CityClass = "X" | "Y" | "Z";

export interface SlipInput {
  basicMinor: bigint;
  /** Dearness Allowance rate in basis points (e.g. 5000 = 50.00%). */
  daRateBps?: bigint;
  /** HRA city classification (X=metro 24/27/30, Y=16/18/20, Z=8/9/10). */
  cityClass?: CityClass;
  /** Monthly Professional Tax to deduct (already capped to FY 2500 limit upstream). */
  ptMinor?: bigint;
  /** Extra ad-hoc components (LOP, loan EMI, arrears, reimbursements). */
  components?: PayComponent[];
  /** Structure components evaluated for fixed/pct (DA & HRA handled specially). */
  rawComponents?: RawComponent[];
  pensionScheme?: PensionScheme;
  /** Income-tax regime + FY start year for monthly TDS (defaults: new / 2025). */
  taxRegime?: Regime;
  fyStartYear?: number;
  /** Old-regime declaration (HRA rent, 80C, 80D, other Chapter VI-A). */
  declaration?: TaxDeclarationInput;
  /** Sec 192 true-up: TDS already deducted YTD this FY + months left (incl. this one). */
  tdsYtdMinor?: bigint;
  monthsRemaining?: number;
  /**
   * P3: protected-net floor (paise). Recovery deductions (LOP, loan EMI, arrears
   * recovery) are capped so net pay never drops below this floor; the uncapped
   * remainder is reported as `recoveryCarryForwardMinor` to be recovered later.
   */
  protectedNetFloorMinor?: bigint;
  /** Sec 10(5) LTC exemption total for this employee in the current FY (paise). */
  ltcExemptTotalMinor?: bigint;
}

/** Deduction codes treated as "recovery" — subject to the protected-net floor. */
const RECOVERY_CODES = new Set(["LOP", "LOAN_EMI", "ARREAR_RECOVERY"]);

export interface SlipResult {
  grossMinor: bigint;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;
  daMinor: bigint;
  hraMinor: bigint;
  earnings: PayComponent[];
  deductions: PayComponent[];
  pfEmployeeMinor: bigint;
  pfEmployerMinor: bigint;   // total employer 12%
  epsMinor: bigint;          // employer EPS portion (8.33%, capped 1250)
  epfEmployerMinor: bigint;  // employer EPF portion (12% total - EPS)
  esiMinor: bigint;
  esiEmployerMinor: bigint;
  ptMinor: bigint;
  tdsMinor: bigint;
  gpfMinor: bigint;
  npsEmployeeMinor: bigint;
  npsEmployerMinor: bigint;
  annualTaxableMinor: bigint;
  negativeNet: boolean;
  /** P3: recovery (LOP/EMI/arrears) deferred because it would breach the net floor. */
  recoveryCarryForwardMinor: bigint;
}

const PF_PCT      = 12n;
const PF_WAGE_CAP = 1_500_000n;  // EPF/EPS wage ceiling: 15000 INR
const EPS_CAP     = 125_000n;    // EPS max: 1250 INR (8.33% of 15000)
const ESI_CAP     = 2_100_000n;  // ESI gross ceiling: 21000 INR
const GPF_PCT     = 10n;
const NPS_EMP_PCT = 10n;
const NPS_ER_PCT  = 14n;
const GRATUITY_CAP = 200_000_000n; // 20 lakh INR

/** Round a paise amount to the nearest whole rupee (round-half-up). */
export function roundRupee(x: bigint): bigint {
  if (x < 0n) return -roundRupee(-x);
  return ((x + 50n) / 100n) * 100n;
}

function pct(base: bigint, percent: bigint): bigint {
  return roundRupee((base * percent) / 100n);
}

/** 7th CPC HRA slab % by city class, escalating with DA threshold (50% / 100%). */
export function hraSlabPct(cityClass: CityClass, daRateBps: bigint): bigint {
  const tier = daRateBps >= 10000n ? 2 : daRateBps >= 5000n ? 1 : 0; // DA>=100% / >=50%
  const table: Record<CityClass, [bigint, bigint, bigint]> = {
    X: [24n, 27n, 30n],
    Y: [16n, 18n, 20n],
    Z: [8n, 9n, 10n],
  };
  return table[cityClass][tier];
}

export function computeSlip(input: SlipInput): SlipResult {
  const {
    basicMinor,
    daRateBps = 0n,
    cityClass = "X",
    ptMinor = 0n,
    components = [],
    rawComponents = [],
    pensionScheme = "EPF",
    taxRegime = "new",
    fyStartYear = 2025,
    declaration = {},
    tdsYtdMinor,
    monthsRemaining,
    protectedNetFloorMinor = 0n,
    ltcExemptTotalMinor = 0n,
  } = input;

  const earnings: PayComponent[] = [];
  const deductions: PayComponent[] = [];

  // Basic is the first earning.
  earnings.push({ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: basicMinor });

  // Dearness Allowance = DA% of basic.
  const daMinor = roundRupee((basicMinor * daRateBps) / 10000n);
  if (daMinor > 0n) earnings.push({ code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: daMinor });

  // HRA = city-class slab % of basic (escalates with DA threshold).
  const hraMinor = pct(basicMinor, hraSlabPct(cityClass, daRateBps));
  if (hraMinor > 0n) earnings.push({ code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: hraMinor });

  // Evaluate remaining structure components (skip BASIC/DA/HRA — handled above).
  for (const c of rawComponents) {
    if (["BASIC", "DA", "HRA"].includes(c.code)) continue;
    const amt = c.pctOfBasic != null && c.pctOfBasic > 0
      ? pct(basicMinor, BigInt(Math.round(c.pctOfBasic)))
      : roundRupee(c.fixedMinor ?? 0n);
    if (amt === 0n) continue;
    (c.type === "earning" ? earnings : deductions).push({ code: c.code, name: c.name, type: c.type, amountMinor: amt });
  }

  // Ad-hoc components (LOP, EMI, arrears, reimbursements).
  for (const c of components) {
    (c.type === "earning" ? earnings : deductions).push({ ...c, amountMinor: roundRupee(c.amountMinor) });
  }

  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);

  // Pension contributions are computed on Basic + DA.
  const pensionBase = basicMinor + daMinor;

  let pfEmployeeMinor = 0n, pfEmployerMinor = 0n, epsMinor = 0n, epfEmployerMinor = 0n;
  let gpfMinor = 0n, npsEmployeeMinor = 0n, npsEmployerMinor = 0n;

  if (pensionScheme === "GPF") {
    gpfMinor = pct(pensionBase, GPF_PCT);
  } else if (pensionScheme === "NPS") {
    npsEmployeeMinor = pct(pensionBase, NPS_EMP_PCT);
    npsEmployerMinor = pct(pensionBase, NPS_ER_PCT);
  } else {
    const pfWage    = pensionBase > PF_WAGE_CAP ? PF_WAGE_CAP : pensionBase;
    pfEmployeeMinor = pct(pfWage, PF_PCT);
    pfEmployerMinor = pct(pfWage, PF_PCT);
    const epsWage   = pensionBase > PF_WAGE_CAP ? PF_WAGE_CAP : pensionBase;
    epsMinor        = roundRupee((epsWage * 833n) / 10000n);
    if (epsMinor > EPS_CAP) epsMinor = EPS_CAP;
    epfEmployerMinor = pfEmployerMinor - epsMinor;
  }

  const esiMinor         = grossMinor <= ESI_CAP ? roundRupee((grossMinor * 75n) / 10000n) : 0n;
  const esiEmployerMinor = grossMinor <= ESI_CAP ? roundRupee((grossMinor * 325n) / 10000n) : 0n;

  const pt = roundRupee(ptMinor);
  if (pt > 0n) deductions.push({ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: pt });

  // Monthly TDS (Sec 192) on real annual TAXABLE income: regime-aware, with
  // Sec 16 std deduction + PT, Sec 10(13A) HRA exemption, and Chapter VI-A (old regime).
  const annualGross = grossMinor * 12n;
  // Additions taxed under BOTH regimes (added before slabs):
  //  - perquisites Sec 17(2) (current employer, not part of cash gross),
  //  - previous-employer taxable salary for the FY (Sec 192(2)),
  //  - income from other sources.
  const perqMinor       = declaration.perquisitesMinor ?? 0n;
  const prevEmpSalMinor = declaration.prevEmployerSalaryMinor ?? 0n;
  const otherSrcMinor   = declaration.otherSourcesIncomeMinor ?? 0n;
  const extraIncome     = perqMinor + prevEmpSalMinor + otherSrcMinor;
  let annualTaxableMinor: bigint;
  if (taxRegime === "old") {
    const salaryHraAnnual   = (basicMinor + daMinor) * 12n;
    const hraReceivedAnnual = hraMinor * 12n;
    const rentAnnual        = declaration.rentPaidAnnualMinor ?? 0n;
    const hraExempt = hraExemptionMinor(salaryHraAnnual, hraReceivedAnnual, rentAnnual, cityClass === "X");
    const d80c = declaration.ded80cMinor ?? 0n; const c80c = d80c > 15_000_000n ? 15_000_000n : d80c;
    const d80d = declaration.ded80dMinor ?? 0n; const c80d = d80d > 7_500_000n ? 7_500_000n : d80d;
    const other = declaration.otherDedMinor ?? 0n;
    annualTaxableMinor = annualGross + extraIncome - 5_000_000n - hraExempt - c80c - c80d - other - pt * 12n - ltcExemptTotalMinor;
  } else {
    annualTaxableMinor = annualGross + extraIncome - 7_500_000n - ltcExemptTotalMinor; // new regime: standard deduction + LTC exempt
  }
  if (annualTaxableMinor < 0n) annualTaxableMinor = 0n;
  const annualTaxMinor = annualTaxFromTaxableMinor(annualTaxableMinor, taxRegime, fyStartYear);
  const tdsMinor = monthsRemaining != null
    ? trueUpTdsMinor(annualTaxMinor, tdsYtdMinor ?? 0n, monthsRemaining)         // Sec 192 true-up
    : (annualTaxMinor / 100n / 12n) * 100n;                                       // flat /12 fallback

  // Statutory pension/insurance/tax deductions are never floored.
  const statutoryDeductions = pfEmployeeMinor + esiMinor + tdsMinor + gpfMinor + npsEmployeeMinor;

  // Split ad-hoc deductions into recovery (floor-capped) and fixed (e.g. PT, and
  // any structure-defined deduction). Fixed deductions are not subject to the floor.
  const recoveryRequested = deductions
    .filter((d) => RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);
  const fixedAdHoc = deductions
    .filter((d) => !RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);

  // Headroom available for recovery after gross less all non-recovery deductions,
  // keeping net at or above the protected floor.
  const nonRecovery   = statutoryDeductions + fixedAdHoc;
  const headroom      = grossMinor - nonRecovery - protectedNetFloorMinor;
  const recoveryCap   = headroom < 0n ? 0n : headroom;
  const recoveryApplied = recoveryRequested > recoveryCap ? recoveryCap : recoveryRequested;
  const recoveryCarryForwardMinor = recoveryRequested - recoveryApplied;

  // If recovery was capped, scale down the recovery deduction line items so the
  // persisted slip reflects what was actually withheld (carry the remainder).
  if (recoveryCarryForwardMinor > 0n && recoveryRequested > 0n) {
    let remainingToTrim = recoveryCarryForwardMinor;
    // Trim from the largest recovery lines first (deterministic by amount desc).
    const recoveryLines = deductions
      .filter((d) => RECOVERY_CODES.has(d.code))
      .sort((a, b) => (a.amountMinor < b.amountMinor ? 1 : -1));
    for (const line of recoveryLines) {
      if (remainingToTrim <= 0n) break;
      const trim = line.amountMinor < remainingToTrim ? line.amountMinor : remainingToTrim;
      line.amountMinor -= trim;
      remainingToTrim -= trim;
    }
    // Drop fully-trimmed recovery lines.
    for (let i = deductions.length - 1; i >= 0; i--) {
      const d = deductions[i]!;
      if (RECOVERY_CODES.has(d.code) && d.amountMinor === 0n) deductions.splice(i, 1);
    }
  }

  const totalDeductions = nonRecovery + recoveryApplied;
  const netRaw          = grossMinor - totalDeductions;
  // With the floor enforced, netRaw can still legitimately be 0 (no floor + full
  // recovery). negativeNet now only ever true if floor is 0 and fixed/statutory
  // alone exceed gross (an upstream data error worth flagging as an exception).
  const negativeNet     = netRaw < 0n;

  return {
    grossMinor,
    totalDeductionsMinor: totalDeductions,
    netPayMinor: negativeNet ? 0n : netRaw,
    recoveryCarryForwardMinor,
    daMinor, hraMinor, earnings, deductions,
    pfEmployeeMinor, pfEmployerMinor, epsMinor, epfEmployerMinor,
    esiMinor, esiEmployerMinor, ptMinor: pt, tdsMinor,
    gpfMinor, npsEmployeeMinor, npsEmployerMinor, annualTaxableMinor, negativeNet,
  };
}

// ============================ Pensioner payroll ============================

/**
 * CCS (Pension) additional-pension (quantum of pension) age bands. From the age
 * the pensioner attains in the run month, an extra % of basic pension is paid:
 *   80–84: 20%, 85–89: 30%, 90–94: 40%, 95–99: 50%, 100+: 100%.
 */
export function additionalPensionPct(ageYears: number): bigint {
  if (ageYears >= 100) return 100n;
  if (ageYears >= 95)  return 50n;
  if (ageYears >= 90)  return 40n;
  if (ageYears >= 85)  return 30n;
  if (ageYears >= 80)  return 20n;
  return 0n;
}

/** Whole years attained on/before the last day of the run month (YYYY-MM). */
export function ageAtMonth(dobIso: string, month: string): number {
  const dob = new Date(`${dobIso.slice(0, 10)}T00:00:00Z`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  // Reference = last day of run month.
  const ref = new Date(Date.UTC(y, m, 0));
  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const mo = ref.getUTCMonth() - dob.getUTCMonth();
  if (mo < 0 || (mo === 0 && ref.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age < 0 ? 0 : age;
}

export interface PensionInput {
  basicPensionMinor: bigint;
  /** Dearness Relief rate in basis points (same series as DA, e.g. 5000 = 50%). */
  drRateBps?: bigint;
  /** Portion of basic pension that was commuted (deducted until restoration). */
  commutedPensionMinor?: bigint;
  /** Commutation date — commuted portion is restored 15 years after it. */
  commutationDate?: string | null;
  /** Fixed monthly medical allowance (paise). */
  medicalAllowanceMinor?: bigint;
  /** Pensioner date of birth (drives additional-pension age band). */
  dateOfBirth: string;
  /** Run month YYYY-MM. */
  month: string;
  /** Monthly TDS on pension (pension is taxable as salary). 0 if none. */
  tdsMinor?: bigint;
}

export interface PensionResult {
  grossMinor: bigint;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;
  basicPensionMinor: bigint;
  /** Net basic pension actually disbursed (basic less un-restored commutation). */
  payableBasicPensionMinor: bigint;
  drMinor: bigint;
  additionalPensionMinor: bigint;
  additionalPensionPct: bigint;
  medicalAllowanceMinor: bigint;
  commutationDeductionMinor: bigint;
  commutationRestored: boolean;
  tdsMinor: bigint;
  ageYears: number;
  earnings: PayComponent[];
  deductions: PayComponent[];
}

/**
 * Monthly pension computation (distinct from the salary slip):
 *   gross = basic pension + additional pension (age band % of basic)
 *           + DR on (basic + additional) + fixed medical allowance.
 * The commuted portion is withheld from basic until it is restored 15 years
 * after the commutation date (CCS rule), after which the full basic is paid.
 * DR (Dearness Relief) is computed on basic + additional pension.
 */
export function computePension(input: PensionInput): PensionResult {
  const {
    basicPensionMinor,
    drRateBps = 0n,
    commutedPensionMinor = 0n,
    commutationDate = null,
    medicalAllowanceMinor = 0n,
    dateOfBirth,
    month,
    tdsMinor = 0n,
  } = input;

  const ageYears = ageAtMonth(dateOfBirth, month);
  const addlPct = additionalPensionPct(ageYears);
  const additionalPensionMinor = pct(basicPensionMinor, addlPct);

  // Restoration: 15 years after commutation date the commuted portion is restored.
  let commutationRestored = true;
  if (commutedPensionMinor > 0n && commutationDate) {
    const cd = new Date(`${commutationDate.slice(0, 10)}T00:00:00Z`);
    const restoreOn = new Date(Date.UTC(cd.getUTCFullYear() + 15, cd.getUTCMonth(), cd.getUTCDate()));
    const [y, m] = month.split("-").map(Number) as [number, number];
    const runEnd = new Date(Date.UTC(y, m, 0));
    commutationRestored = runEnd >= restoreOn;
  } else if (commutedPensionMinor > 0n) {
    // Commuted but no date provided — treat as not yet restored.
    commutationRestored = false;
  }
  const commutationDeductionMinor = commutationRestored ? 0n : commutedPensionMinor;
  const payableBasicPensionMinor = basicPensionMinor - commutationDeductionMinor;

  // DR is on basic + additional pension (full basic, not reduced by commutation).
  const drBase = basicPensionMinor + additionalPensionMinor;
  const drMinor = roundRupee((drBase * drRateBps) / 10000n);
  const medical = roundRupee(medicalAllowanceMinor);

  const earnings: PayComponent[] = [];
  earnings.push({ code: "BASIC_PENSION", name: "Basic Pension", type: "earning", amountMinor: basicPensionMinor });
  if (additionalPensionMinor > 0n)
    earnings.push({ code: "ADDL_PENSION", name: `Additional Pension (${addlPct}%)`, type: "earning", amountMinor: additionalPensionMinor });
  if (drMinor > 0n)
    earnings.push({ code: "DR", name: "Dearness Relief", type: "earning", amountMinor: drMinor });
  if (medical > 0n)
    earnings.push({ code: "FMA", name: "Medical Allowance", type: "earning", amountMinor: medical });

  // Gross is the full entitlement; commutation withholding and TDS are deductions.
  const grossMinor = basicPensionMinor + additionalPensionMinor + drMinor + medical;

  const deductions: PayComponent[] = [];
  if (commutationDeductionMinor > 0n)
    deductions.push({ code: "COMMUTATION", name: "Commuted Pension", type: "deduction", amountMinor: commutationDeductionMinor });
  const tds = roundRupee(tdsMinor);
  if (tds > 0n)
    deductions.push({ code: "TDS", name: "Income Tax (TDS)", type: "deduction", amountMinor: tds });

  const totalDeductionsMinor = commutationDeductionMinor + tds;
  const netPayMinor = grossMinor - totalDeductionsMinor;

  return {
    grossMinor, totalDeductionsMinor, netPayMinor,
    basicPensionMinor, payableBasicPensionMinor,
    drMinor, additionalPensionMinor, additionalPensionPct: addlPct,
    medicalAllowanceMinor: medical,
    commutationDeductionMinor, commutationRestored,
    tdsMinor: tds, ageYears, earnings, deductions,
  };
}

export function assertRunStatusTransition(current: string, next: string): void {
  const allowed: Record<string, string[]> = {
    draft:      ["processing"],
    processing: ["approved", "failed"],
    approved:   ["disbursed"],
    disbursed:  [],
    failed:     ["draft"],
  };
  if (!(allowed[current] ?? []).includes(next)) {
    throw new DomainError("INVALID_STATUS_TRANSITION", `cannot move payroll run from '${current}' to '${next}'`);
  }
}

/**
 * Payment of Gratuity Act / CCS: (15/26) * (last Basic+DA) * completed years,
 * where >=6 months in the final year rounds up; capped at 20 lakh.
 */
export function computeGratuity(yearsOfService: number, lastBasicMinor: bigint, lastDaMinor = 0n): bigint {
  if (yearsOfService < 5) return 0n;
  const whole = Math.floor(yearsOfService);
  const fracMonths = Math.round((yearsOfService - whole) * 12);
  const completedYears = BigInt(whole + (fracMonths >= 6 ? 1 : 0));
  const emoluments = lastBasicMinor + lastDaMinor;
  const raw = (emoluments * 15n * completedYears) / 26n;
  const rounded = roundRupee(raw);
  return rounded > GRATUITY_CAP ? GRATUITY_CAP : rounded;
}

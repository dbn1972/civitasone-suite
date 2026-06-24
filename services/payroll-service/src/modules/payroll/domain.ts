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
}

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
    annualTaxableMinor = annualGross + extraIncome - 5_000_000n - hraExempt - c80c - c80d - other - pt * 12n;
  } else {
    annualTaxableMinor = annualGross + extraIncome - 7_500_000n; // new regime: standard deduction only
  }
  if (annualTaxableMinor < 0n) annualTaxableMinor = 0n;
  const annualTaxMinor = annualTaxFromTaxableMinor(annualTaxableMinor, taxRegime, fyStartYear);
  const tdsMinor = monthsRemaining != null
    ? trueUpTdsMinor(annualTaxMinor, tdsYtdMinor ?? 0n, monthsRemaining)         // Sec 192 true-up
    : (annualTaxMinor / 100n / 12n) * 100n;                                       // flat /12 fallback

  const adHocDeductions = deductions.reduce((s, d) => s + d.amountMinor, 0n);
  const totalDeductions = adHocDeductions + pfEmployeeMinor + esiMinor + tdsMinor + gpfMinor + npsEmployeeMinor;
  const netRaw          = grossMinor - totalDeductions;
  const negativeNet     = netRaw < 0n;

  return {
    grossMinor,
    totalDeductionsMinor: totalDeductions,
    netPayMinor: negativeNet ? 0n : netRaw,
    daMinor, hraMinor, earnings, deductions,
    pfEmployeeMinor, pfEmployerMinor, epsMinor, epfEmployerMinor,
    esiMinor, esiEmployerMinor, ptMinor: pt, tdsMinor,
    gpfMinor, npsEmployeeMinor, npsEmployerMinor, annualTaxableMinor, negativeNet,
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

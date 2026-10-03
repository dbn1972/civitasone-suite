import { hraExemptionMinor, annualTaxFromTaxableMinor, trueUpTdsMinor, stdDeduction, divRoundBig, PLATFORM_DEFAULT_TENANT_ID, type Regime } from "../tax/engine.js";

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
  /**
   * Engagement-policy statutory gates (DIC). Default true — omitting them keeps
   * pre-engagement behaviour. When false, that statutory head is suppressed:
   * consultants / third-party / apprentices carry NO PF, ESI or NPS. Payroll
   * eligibility itself (whether a slip is generated at all) is enforced upstream
   * via isPayrollEligible(); this only gates the deduction heads on a slip.
   */
  statutoryPf?: boolean;
  statutoryEsi?: boolean;
  statutoryNps?: boolean;
  /** Income-tax regime + FY start year for monthly TDS (defaults: new / 2025). */
  taxRegime?: Regime;
  fyStartYear?: number;
  /**
   * DOM-008 (completing #1117): tenant to resolve payroll.tax_slab_config
   * for (stdDeduction()/annualTaxFromTaxableMinor() below). Omit for the
   * platform default (pre-DOM-008 behaviour, byte-identical) — engine.ts's
   * getTaxConfig() falls back to the platform default automatically even
   * when supplied, if the tenant has no override for this (regime, FY).
   */
  taxTenantId?: string;
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
  /**
   * DOM-008: effective-dated PF/ESI/Chapter-VI-A statutory config. Optional —
   * defaults to DEFAULT_STATUTORY_CONFIG, byte-identical to the pre-DOM-008
   * hardcoded constants, so every existing caller that omits this field keeps
   * computing exactly what it always has. Callers with DB access should
   * resolve the effective row via resolveStatutoryConfig() first.
   */
  statutoryConfig?: StatutoryConfig;
  /**
   * FR 53 (suspension): pre-computed pay lines that REPLACE the regular
   * BASIC/DA/HRA + structure-component block (see subsistence.ts's
   * computeSubsistenceEarnings). Omitted for every non-suspended employee, in
   * which case computeSlip runs exactly the code path it always has.
   */
  earningsOverride?: EarningsOverride;
  /**
   * PAY-PROFILES: which pay computation applies. OMITTED == govt_scale, and
   * with `hraFloorMinor` also omitted computeSlip executes exactly the
   * pre-PAY-PROFILES statements (byte-identical output; proven by the
   * legacy-oracle property test). See SlipPayProfile.
   */
  payProfile?: SlipPayProfile;
  /**
   * PAY-PROFILES: 7th CPC HRA minimum floor (paise) for this employee's city
   * class, from the effective allowance rules. Omitted / 0n == no floor.
   * Applies to government-scale HRA only (govt_scale + deputation profiles).
   */
  hraFloorMinor?: bigint;
}

/** FR 53 suspension pay lines + the bases computeSlip derives from them. */
export interface EarningsOverride {
  /** Earning and structure-deduction lines, already rounded to whole rupees. */
  components: PayComponent[];
  /** Total DA paid (regular-days DA + DA on subsistence allowance). */
  daMinor: bigint;
  hraMinor: bigint;
  /** GPF/NPS/EPF wage base: Basic + DA actually paid for the regular (non-suspended) days only. */
  pensionBaseMinor: bigint;
  /** Sec 10(13A) "salary" (Basic + DA, incl. subsistence allowance + its DA) for the old-regime HRA exemption. */
  hraSalaryMinor: bigint;
}

/**
 * PAY-PROFILES: per-employee pay computation (the earnings stage); the
 * deduction tail is shared by every profile.
 *
 *  govt_scale              BASIC + central DA + max(7th CPC HRA slab, floor)
 *  deputation_parent_scale Option A: as govt_scale on the PARENT basic, plus
 *                          the deputation (duty) allowance (DEP_ALLOW) --
 *                          excluded from the DA, HRA and pension bases
 *  deputation_post_scale   Option B: as govt_scale on the POST basic, no allowance
 *  consolidated_contract   one consolidated amount (passed already pro-rated
 *                          for paid days as basicMinor), no DA/HRA; EPF (when
 *                          the engagement has PF) regardless of the HRMS
 *                          pension_scheme default
 *
 * ctc_contract is computed by the CTC module (PAY-PROFILES PR3) and is
 * rejected here.
 */
export type SlipPayProfile =
  | { kind: "govt_scale" }
  | { kind: "deputation_parent_scale"; allowance: DeputationAllowanceInput }
  | { kind: "deputation_post_scale" }
  | { kind: "consolidated_contract" };

export type DeputationStationType = "same" | "other";

/** One station type's deputation-allowance rule: % of basic (bps) capped at a rupee amount. */
export interface DeputationAllowanceRule { rateBps: bigint; capMinor: bigint }

export interface DeputationAllowanceInput {
  /** auto: tenant rule when configured, else fixedMinor; fixed: per-employee override. */
  mode: "auto" | "fixed";
  /** Amount recorded on the deputation order (paise/month). */
  fixedMinor: bigint;
  stationType: DeputationStationType | null;
  /** The tenant's effective rule for the employee's station type, or null when not configured. */
  rule: DeputationAllowanceRule | null;
}

/**
 * Deputation (duty) allowance for Option A. Computed (min(% of basic, cap))
 * once the tenant has configured a rule for the station type; until then --
 * or when the deputation order fixes an amount (mode "fixed") -- the amount
 * recorded on the order. Pure.
 */
export function deputationAllowanceMinor(basicMinor: bigint, a: DeputationAllowanceInput): { amountMinor: bigint; basis: "computed" | "fixed" } {
  if (a.mode === "auto" && a.rule && a.stationType) {
    const pctAmount = roundRupee((basicMinor * a.rule.rateBps) / 10000n);
    return { amountMinor: pctAmount < a.rule.capMinor ? pctAmount : a.rule.capMinor, basis: "computed" };
  }
  return { amountMinor: roundRupee(a.fixedMinor), basis: "fixed" };
}

/**
 * Government-scale HRA: the 7th CPC slab % of basic, but never below the
 * city-class minimum floor. A zero basic never attracts the floor. With
 * floor 0n this is exactly `pct(basic, hraSlabPct(...))`. Pure.
 */
export function govtHraMinor(basicMinor: bigint, cityClass: CityClass, daRateBps: bigint, floorMinor = 0n): bigint {
  const slab = pct(basicMinor, hraSlabPct(cityClass, daRateBps));
  return basicMinor > 0n && slab < floorMinor ? floorMinor : slab;
}

/** Deduction codes treated as "recovery" — subject to the protected-net floor. */
const RECOVERY_CODES = new Set(["LOP", "LOAN_EMI", "ARREAR_RECOVERY"]);

/**
 * Engagement-policy gate: whether an employee of this engagement type is paid
 * through the SALARY payroll at all. Consultants (invoice / 194J), third-party
 * (agency / 194C) and apprentices (stipend) are NOT — they are handled by their
 * own flows, so the salary run must skip them. Defaults to eligible when no
 * policy is supplied, preserving pre-engagement behaviour. Pure.
 */
export function isPayrollEligible(emp: { paymentRoute?: string | null; eligibleForPayroll?: boolean | null }): boolean {
  if (emp.eligibleForPayroll === false) return false;
  const route = (emp.paymentRoute ?? "payroll").toLowerCase();
  return route === "payroll";
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
  /** P3: recovery (LOP/EMI/arrears) deferred because it would breach the net floor. */
  recoveryCarryForwardMinor: bigint;
}

/**
 * DOM-008: PF/ESI/EPS rates and Chapter VI-A caps used to be hardcoded here,
 * and the tenant-override columns in statutory/schema.ts (empContribPct etc.)
 * were written on every slip but never read back — changing a rate required a
 * code deploy. Now config-driven via `statutory.statutory_config` (see
 * migration 0038): tenant_id uses this codebase's sentinel-zero-UUID
 * platform-default convention (see notification-service migration 0045),
 * effective-dated rows, resolved by resolveStatutoryConfig() below. The
 * `statutoryConfig` field on SlipInput is OPTIONAL and defaults to exactly
 * these values, so every existing/omitting caller (all current tests, and
 * any caller not yet updated) computes byte-identical output to before.
 */
export interface StatutoryConfig {
  pfRatePct: bigint;          // employee AND employer EPF rate, e.g. 12n = 12%
  pfWageCapMinor: bigint;     // EPF/EPS wage ceiling, paise (₹15,000 = 1_500_000n)
  epsRateBps: bigint;         // EPS rate, basis points, e.g. 833n = 8.33%
  epsCapMinor: bigint;        // EPS employer-portion monthly cap, paise (₹1,250 = 125_000n)
  esiWageCapMinor: bigint;    // ESI applicability gross ceiling, paise (₹21,000 = 2_100_000n)
  esiEmployeeRateBps: bigint; // e.g. 75n = 0.75%
  esiEmployerRateBps: bigint; // e.g. 325n = 3.25%
  sec80cCapMinor: bigint;     // Chapter VI-A Sec 80C cap, paise (₹1,50,000 = 15_000_000n)
  sec80dCapMinor: bigint;     // Chapter VI-A Sec 80D cap, paise (₹75,000 = 7_500_000n)
  sec80ccd1bCapMinor: bigint; // Chapter VI-A Sec 80CCD(1B) cap (NPS additional), paise (₹50,000 = 5_000_000n) — DOM-034
}

/** The exact values that were hardcoded pre-DOM-008 — never change silently. */
export const DEFAULT_STATUTORY_CONFIG: StatutoryConfig = {
  pfRatePct: 12n,
  pfWageCapMinor: 1_500_000n,
  epsRateBps: 833n,
  epsCapMinor: 125_000n,
  esiWageCapMinor: 2_100_000n,
  esiEmployeeRateBps: 75n,
  esiEmployerRateBps: 325n,
  sec80cCapMinor: 15_000_000n,
  sec80dCapMinor: 7_500_000n,
  sec80ccd1bCapMinor: 5_000_000n,
};

/** A `statutory.statutory_config` row as loaded from the DB; `tenantId: null` means platform default (DB sentinel zero-UUID mapped to null at the repo boundary). */
export interface StatutoryConfigRow extends StatutoryConfig {
  tenantId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
}

/**
 * Effective-dated, pure resolution: the tenant's own latest override with
 * `effectiveFrom` on/before `periodMonth` (YYYY-MM) wins; else the platform
 * default's latest row on/before it; else the literal DEFAULT_STATUTORY_CONFIG
 * (belt-and-suspenders — migration 0038 always seeds a platform-default row,
 * so this last fallback should never be reached in practice, but computeSlip
 * must never throw for a missing config row in a payroll run).
 */
export function resolveStatutoryConfig(rows: StatutoryConfigRow[], tenantId: string, periodMonth: string): StatutoryConfig {
  const onOrBefore = `${periodMonth}-01`;
  const eligible = rows.filter((r) => r.effectiveFrom <= onOrBefore);
  const latest = (candidates: StatutoryConfigRow[]): StatutoryConfigRow | undefined =>
    candidates.reduce<StatutoryConfigRow | undefined>((best, r) => (!best || r.effectiveFrom > best.effectiveFrom ? r : best), undefined);
  const picked = latest(eligible.filter((r) => r.tenantId === tenantId))
    ?? latest(eligible.filter((r) => r.tenantId === null));
  if (!picked) return DEFAULT_STATUTORY_CONFIG;
  // Strip the row-only fields (tenantId, effectiveFrom) so the result is
  // always a plain StatutoryConfig, identical in shape whether it came from a
  // resolved row or the DEFAULT_STATUTORY_CONFIG fallback above.
  const {
    pfRatePct, pfWageCapMinor, epsRateBps, epsCapMinor, esiWageCapMinor,
    esiEmployeeRateBps, esiEmployerRateBps, sec80cCapMinor, sec80dCapMinor, sec80ccd1bCapMinor,
  } = picked;
  return {
    pfRatePct, pfWageCapMinor, epsRateBps, epsCapMinor, esiWageCapMinor,
    esiEmployeeRateBps, esiEmployerRateBps, sec80cCapMinor, sec80dCapMinor, sec80ccd1bCapMinor,
  };
}

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

/** 7th CPC HRA slab % by city class, escalating with DA threshold (25% / 50%). */
export function hraSlabPct(cityClass: CityClass, daRateBps: bigint): bigint {
  const tier = daRateBps >= 5000n ? 2 : daRateBps >= 2500n ? 1 : 0; // DA>=50% / >=25%
  const table: Record<CityClass, [bigint, bigint, bigint]> = {
    X: [24n, 27n, 30n],
    Y: [16n, 18n, 20n],
    Z: [8n, 9n, 10n],
  };
  return table[cityClass][tier];
}

/**
 * Monthly amount of one configured structure component (fixed, or % of basic).
 * pctOfBasic takes precedence over fixedMinor when configured and > 0
 * (REL-009: was previously divided by 100n only, inflating every
 * percentage-based component 100x). Math.round(pctOfBasic * 100) preserves
 * 2 decimal places of the percentage as an integer, so the divisor must be
 * 10_000n: 100 to undo that pre-multiplication, and 100 to convert percent
 * to a fraction. E.g. pctOfBasic=12.5 -> round(1250) -> basic*1250/10_000.
 */
export function rawComponentAmountMinor(basicMinor: bigint, c: RawComponent): bigint {
  return c.pctOfBasic != null && c.pctOfBasic > 0
    ? roundRupee((basicMinor * BigInt(Math.round(c.pctOfBasic * 100))) / 10_000n)
    : roundRupee(c.fixedMinor ?? 0n);
}

export function computeSlip(input: SlipInput): SlipResult {
  const {
    basicMinor,
    daRateBps = 0n,
    cityClass = "X",
    ptMinor = 0n,
    components = [],
    rawComponents = [],
    statutoryPf = true,
    statutoryEsi = true,
    taxRegime = "new",
    fyStartYear = 2025,
    declaration = {},
    tdsYtdMinor,
    monthsRemaining,
    protectedNetFloorMinor = 0n,
    ltcExemptTotalMinor = 0n,
    statutoryConfig = DEFAULT_STATUTORY_CONFIG,
    taxTenantId = PLATFORM_DEFAULT_TENANT_ID,
    earningsOverride,
    hraFloorMinor = 0n,
  } = input;
  const profile = input.payProfile ?? { kind: "govt_scale" as const };
  if ((profile.kind as string) === "ctc_contract") {
    throw new DomainError("CTC_PROFILE_NOT_SUPPORTED", "ctc_contract slips are computed by the CTC module (PAY-PROFILES PR3)");
  }
  const consolidated = profile.kind === "consolidated_contract";
  // A consolidated-pay contract employee is on EPF (when the engagement has
  // PF at all) -- never on the NPS/GPF the HRMS pension_scheme column
  // defaults to for government staff.
  const pensionScheme: PensionScheme = consolidated ? "EPF" : input.pensionScheme ?? "EPF";

  const earnings: PayComponent[] = [];
  const deductions: PayComponent[] = [];

  let daMinor: bigint;
  let hraMinor: bigint;
  if (earningsOverride) {
    // FR 53 suspension: subsistence.ts already built the pay lines (regular
    // days prorated + Subsistence Allowance + DA on it + continuing HRA/CCA,
    // and -- PAY-PROFILES -- the profile's basic/DA, the HRA floor and a
    // pro-rated deputation allowance). Copied so the floor-trimming below
    // never mutates the caller's objects.
    for (const c of earningsOverride.components) {
      (c.type === "earning" ? earnings : deductions).push({ ...c });
    }
    daMinor = earningsOverride.daMinor;
    hraMinor = earningsOverride.hraMinor;
  } else {
    // Basic is the first earning.
    earnings.push({ code: "BASIC", name: consolidated ? "Consolidated Emoluments" : "Basic Pay", type: "earning", amountMinor: basicMinor });

    // Dearness Allowance = DA% of basic (no central DA on consolidated pay).
    daMinor = consolidated ? 0n : roundRupee((basicMinor * daRateBps) / 10000n);
    if (daMinor > 0n) earnings.push({ code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: daMinor });

    // HRA = city-class slab % of basic (escalates with DA threshold), never
    // below the city-class floor (PAY-PROFILES; floor 0n == legacy). None on
    // consolidated pay.
    hraMinor = consolidated ? 0n : govtHraMinor(basicMinor, cityClass, daRateBps, hraFloorMinor);
    if (hraMinor > 0n) earnings.push({ code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: hraMinor });

    // Option A deputation (duty) allowance -- not part of the DA/HRA/pension bases.
    if (profile.kind === "deputation_parent_scale") {
      const dep = deputationAllowanceMinor(basicMinor, profile.allowance);
      if (dep.amountMinor > 0n) earnings.push({ code: "DEP_ALLOW", name: "Deputation (Duty) Allowance", type: "earning", amountMinor: dep.amountMinor });
    }

    // Evaluate remaining structure components (skip BASIC/DA/HRA — handled above).
    for (const c of rawComponents) {
      if (["BASIC", "DA", "HRA"].includes(c.code)) continue;
      const amt = rawComponentAmountMinor(basicMinor, c);
      if (amt === 0n) continue;
      (c.type === "earning" ? earnings : deductions).push({ code: c.code, name: c.name, type: c.type, amountMinor: amt });
    }
  }

  // Ad-hoc components (LOP, EMI, arrears, reimbursements).
  for (const c of components) {
    (c.type === "earning" ? earnings : deductions).push({ ...c, amountMinor: roundRupee(c.amountMinor) });
  }

  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);

  // Pension contributions are computed on Basic + DA. FR 53 suspension: only
  // the regular days' Basic + DA (FR 53(2)(ii): no GPF subscription from
  // subsistence allowance -- see subsistence.ts).
  const pensionBase = earningsOverride ? earningsOverride.pensionBaseMinor : basicMinor + daMinor;

  let pfEmployeeMinor = 0n, pfEmployerMinor = 0n, epsMinor = 0n, epfEmployerMinor = 0n;
  let gpfMinor = 0n, npsEmployeeMinor = 0n, npsEmployerMinor = 0n;

  if (pensionScheme === "GPF") {
    gpfMinor = pct(pensionBase, GPF_PCT);
  } else if (pensionScheme === "NPS") {
    // Pension scheme is authoritative per-employee: an employee on NPS always
    // gets NPS. (The engagement type gates payroll INCLUSION via isPayrollEligible
    // — an excluded type never reaches computeSlip — not which pension scheme
    // applies. Gating NPS by a type flag here previously zeroed pension entirely
    // for an NPS-scheme employee of a type with statutoryNps=false, with no
    // fall-through to EPF. statutoryNps is retained on SlipInput for callers but
    // no longer suppresses a scheme-driven contribution.)
    npsEmployeeMinor = pct(pensionBase, NPS_EMP_PCT);
    npsEmployerMinor = pct(pensionBase, NPS_ER_PCT);
  } else if (statutoryPf) {
    // Engagement gate: no EPF/EPS for a type whose policy excludes provident fund.
    const pfWage    = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    pfEmployeeMinor = pct(pfWage, statutoryConfig.pfRatePct);
    pfEmployerMinor = pct(pfWage, statutoryConfig.pfRatePct);
    const epsWage   = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    epsMinor        = roundRupee((epsWage * statutoryConfig.epsRateBps) / 10000n);
    if (epsMinor > statutoryConfig.epsCapMinor) epsMinor = statutoryConfig.epsCapMinor;
    epfEmployerMinor = pfEmployerMinor - epsMinor;
  }

  // Engagement gate: ESI only when the type's policy allows it AND under the cap.
  const esiApplicable    = statutoryEsi && grossMinor <= statutoryConfig.esiWageCapMinor;
  const esiMinor         = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployeeRateBps) / 10000n) : 0n;
  const esiEmployerMinor = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployerRateBps) / 10000n) : 0n;

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
  // DOM-008: standard deduction now sourced from payroll.tax_slab_config (the
  // same FY-versioned config fnf/domain.ts and tax/routes.ts already read via
  // stdDeduction()) instead of a second literal that had to be kept in sync by
  // hand. stdDeduction() throws UnconfiguredFyError for an unregistered
  // (regime, FY) exactly like annualTaxFromTaxableMinor() below already does
  // for this same pair, so this adds no new failure mode.
  const stdDeductionMinor = BigInt(stdDeduction(taxRegime, fyStartYear, taxTenantId)) * 100n;
  if (taxRegime === "old") {
    const salaryHraAnnual   = (earningsOverride ? earningsOverride.hraSalaryMinor : basicMinor + daMinor) * 12n;
    const hraReceivedAnnual = hraMinor * 12n;
    const rentAnnual        = declaration.rentPaidAnnualMinor ?? 0n;
    const hraExempt = hraExemptionMinor(salaryHraAnnual, hraReceivedAnnual, rentAnnual, cityClass === "X");
    const d80c = declaration.ded80cMinor ?? 0n; const c80c = d80c > statutoryConfig.sec80cCapMinor ? statutoryConfig.sec80cCapMinor : d80c;
    const d80d = declaration.ded80dMinor ?? 0n; const c80d = d80d > statutoryConfig.sec80dCapMinor ? statutoryConfig.sec80dCapMinor : d80d;
    const other = declaration.otherDedMinor ?? 0n;
    annualTaxableMinor = annualGross + extraIncome - stdDeductionMinor - hraExempt - c80c - c80d - other - pt * 12n - ltcExemptTotalMinor;
  } else {
    annualTaxableMinor = annualGross + extraIncome - stdDeductionMinor - ltcExemptTotalMinor; // new regime: standard deduction + LTC exempt
  }
  if (annualTaxableMinor < 0n) annualTaxableMinor = 0n;
  const annualTaxMinor = annualTaxFromTaxableMinor(annualTaxableMinor, taxRegime, fyStartYear, taxTenantId);
  // LOW (payroll-calc audit): the flat /12 fallback (no monthsRemaining
  // supplied) used plain truncating division, the same under-withholding
  // pattern as the pension-run TDS bug (consumer.ts processPensionRun).
  // Currently unreachable in production -- computeAndInsertSlip's one real
  // caller (processPayrollRun) always supplies monthsRemaining -- but this
  // branch IS exercised directly by callers of computeSlip() that omit it
  // (e.g. a preview/estimate with no run context), so it is fixed for
  // consistency: round-half-up via tax/engine.ts's own divRoundBig, not a
  // flat truncate.
  const tdsMinor = monthsRemaining != null
    ? trueUpTdsMinor(annualTaxMinor, tdsYtdMinor ?? 0n, monthsRemaining)         // Sec 192 true-up
    : roundRupee(divRoundBig(annualTaxMinor, 12n));                              // flat /12 fallback

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
 * Payment of Gratuity Act / CCS 6-month rounding: >=6 months served into the
 * final year of service rounds up to the next completed year. Exported so
 * callers that need the SAME completedYears figure computeGratuity itself
 * used (e.g. integration/consumer.ts's employeeSeparated handler, which also
 * feeds completedYears into the Sec 10(10)/10(10AA) exemption-ceiling
 * formulas in tax/exemptions.ts) can never silently drift onto a different
 * tenure number for the very same separation.
 */
export function completedYearsPgAct(yearsOfService: number): number {
  const whole = Math.floor(yearsOfService);
  const fracMonths = Math.round((yearsOfService - whole) * 12);
  return whole + (fracMonths >= 6 ? 1 : 0);
}

/**
 * Separation causes for which the Payment of Gratuity Act, 1972 §4(1) first
 * proviso — carried forward verbatim in the Code on Social Security, 2020
 * §53(1) proviso — waives the 5-year minimum continuous-service condition:
 * termination of employment by death, or by disablement due to accident or
 * disease. This ONLY removes the eligibility floor: §4(2)/§53(2) apply the
 * exact same (15/26) x emoluments x completed-years formula regardless of
 * cause, with no separate/enhanced formula for the sub-5-year case. A
 * separation with 0 completed years (e.g. death within 6 months of joining)
 * therefore still legitimately computes to 0 — that is the Act's own result,
 * not a bug. "invalidation" is accepted as a synonym for disablement,
 * matching the term this codebase already uses for the equivalent CCS
 * (Pension) Rules waiver (see hrms-service employee/consumer.ts's
 * GRATUITY_ELIGIBLE_TYPES). Matching is case-insensitive; an absent or
 * unrecognised separationType does NOT waive the floor (fail-safe default:
 * the standard 5-year rule applies, preserving behaviour for every existing
 * caller that doesn't pass this argument).
 */
const MIN_SERVICE_WAIVED_SEPARATION_TYPES = new Set(["death", "disablement", "disability", "invalidation"]);

function waivesGratuityMinService(separationType?: string | null): boolean {
  return !!separationType && MIN_SERVICE_WAIVED_SEPARATION_TYPES.has(separationType.toLowerCase());
}

/**
 * Payment of Gratuity Act, 1972 §4(2) / Code on Social Security, 2020 §53(2):
 * (15/26) * (last Basic+DA) * completed years, where >=6 months in the final
 * year rounds up; capped at 20 lakh. The 5-year minimum continuous-service
 * condition (§4(1) / §53(1)) is waived for death/disablement separations —
 * see MIN_SERVICE_WAIVED_SEPARATION_TYPES above for the accepted cause
 * strings and legal basis. Bug fix: this used to apply the 5-year floor
 * unconditionally (no separationType parameter existed at all), silently
 * zeroing out gratuity for every death/disablement separation under 5 years
 * — contrary to the Act — with no error or flag anywhere.
 */
export function computeGratuity(
  yearsOfService: number,
  lastBasicMinor: bigint,
  lastDaMinor = 0n,
  separationType?: string | null,
  /**
   * GAP-PAYROLL-STATUTORY-GRATUITY-01/04: per-tenant overrides of the 5-year
   * floor and the statutory ceiling (gratuity-rules module). Omitted => the
   * legacy constants, so existing callers are byte-identical.
   */
  opts?: { minServiceYears?: number; ceilingMinor?: bigint },
): bigint {
  const minYears = opts?.minServiceYears ?? 5;
  const cap = opts?.ceilingMinor ?? GRATUITY_CAP;
  if (yearsOfService < minYears && !waivesGratuityMinService(separationType)) return 0n;
  const completedYears = BigInt(completedYearsPgAct(yearsOfService));
  const emoluments = lastBasicMinor + lastDaMinor;
  const raw = (emoluments * 15n * completedYears) / 26n;
  const rounded = roundRupee(raw);
  return rounded > cap ? cap : rounded;
}

/**
 * Earned-Leave encashment on separation = (Basic+DA)/30 * min(balance, 300
 * days) -- the same statutory 300-day cap as hrms-service's own elEncashment
 * (pension/engine.ts), but priced off THIS service's own
 * dearness_allowance_rates lookup (see integration/consumer.ts's
 * employeeSeparated handler) rather than a hardcoded DA percentage, so
 * gratuity and leave encashment for the same separation are never priced
 * off two different DA rates. Bigint-paise throughout (no float division),
 * matching this module's own house rule that no money amount is ever
 * produced by float arithmetic.
 */
export function computeLeaveEncashmentGrossMinor(lastBasicMinor: bigint, lastDaMinor: bigint, leaveBalanceDays: number): bigint {
  if (leaveBalanceDays <= 0) return 0n;
  const emoluments = lastBasicMinor + lastDaMinor;
  // GAP-HR-LEAVE-APPLY-05: the balance can now carry a half day (e.g. 10.5), so
  // the day count is taken in half-day units: emoluments * halves / 60 is the
  // same figure as emoluments * days / 30 but never truncates a half day. For a
  // whole-day balance (halves = 2 * days) the result is identical to before.
  const cappedHalves = BigInt(Math.round(Math.min(leaveBalanceDays, 300) * 2));
  return roundRupee((emoluments * cappedHalves) / 60n);
}

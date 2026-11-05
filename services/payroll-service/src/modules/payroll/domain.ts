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
  /** UAT L2-N5: on the LOP line only -- the loss-of-pay days it recovers and the days of the month. */
  lopDays?: number;
  daysInMonth?: number;
  /** Review SF2: of lopDays, the days the employee was NOT in service (before joining / after leaving) -- never NCP days. */
  notInServiceDays?: number;
}

/** Raw structure component as configured (fixed amount OR percentage of basic). */
export interface RawComponent {
  code: string;
  name: string;
  type: "earning" | "deduction";
  fixedMinor?: bigint | null;
  pctOfBasic?: number | null; // e.g. 10 => 10% of basic
}

/**
 * UAT b18 D1: UPS (Unified Pension Scheme, an option under NPS for central
 * government staff from 2025-04-01) is computed like NPS on Basic + DA but
 * with the UPS employer share (UPS_ER_BPS below).
 */
export type PensionScheme = "GPF" | "NPS" | "EPF" | "UPS" | "NONE";
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
  /**
   * Review SF1 (EPS 1995 para 6A): false for an EPF member who is not an EPS
   * member -- EPS = 0 and the whole employer 12% goes to EPF (A/c 1). Default
   * true: omitting it computes exactly what computeSlip always has. See
   * epsEligibility() for the rule.
   */
  epsEligible?: boolean;
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
   * T-STAT F02 (s.192): salary actually paid to this employee earlier in the
   * same FY -- gross of the earlier approved / disbursed slips less their loss
   * of pay, and the number of months they cover. `unrecordedMonths`: earlier
   * FY months in which the employee was already in service but no slip exists
   * in this system (e.g. before go-live); they are estimated at the current
   * regular salary (see unrecordedFyMonths). With it (and monthsRemaining)
   * the annual estimate is
   *   fyPaidToDate + regular x unrecordedMonths + this month (less LOP)
   *   + regular salary x (monthsRemaining - 1) + this month one-offs once.
   * Omitted (a preview with no run context): regular salary x 12 + one-offs once.
   * `unrecordedLopMinor`: loss of pay recorded (LOP ledger) for those
   * unrecorded months, deducted from their estimate. When previous-employer
   * salary is declared (a transfer-in: LPC / Form 12B) the declared figure
   * REPLACES the unrecorded-month estimate (review SF1), so it is skipped.
   */
  fyPaidToDate?: { grossMinor: bigint; months: number; unrecordedMonths?: number; unrecordedLopMinor?: bigint };
  /**
   * PR #2459 delta review SF1: the caller (the run) already decided which
   * months are presumed -- opening YTD coverage, previous employer, go-live
   * boundary -- so a declared previous-employer salary does not zero them again.
   */
  presumedMonthsAuthoritative?: boolean;
  /**
   * T-STAT M-NPS (F04): the Basic + DA part of the arrears paid on this slip
   * (a recovery counts negative). Added to the NPS base only: NPS employee 10%
   * / employer 14% fall on arrears of pay and DA as on pay itself.
   */
  arrearPensionBaseMinor?: bigint;
  /**
   * T-STAT M-PT-BASIS (F08): resolve the month professional tax from the
   * monthly salary (gross earnings of the slip less loss of pay). When given
   * it replaces `ptMinor`; the slab data itself is unchanged.
   */
  ptForSalaryMinor?: (monthlySalaryMinor: bigint) => bigint;
  /**
   * P3: protected-net floor (paise). Recovery deductions (LOP, loan EMI, arrears
   * recovery) are capped so net pay never drops below this floor; the uncapped
   * remainder is reported as `recoveryCarryForwardMinor` to be recovered later.
   */
  protectedNetFloorMinor?: bigint;
  /**
   * UAT T-PERIOD D-02b: the ceiling on the TOTAL deductions of a slip, as a
   * share (basis points, 1..10000) of the wages earned in the month (gross
   * less loss of pay): Code on Wages 2019 s.18(2), 50% -- income-tax is an
   * authorised deduction within the limit. Order: statutory deductions
   * (pension / PF / ESI, PT, fixed deductions, then TDS up to what is left)
   * first, then recoveries (loan EMI, arrear recovery), which are deferred
   * (`recoveryCarryForwardMinor`). TDS not deducted is `tdsShortfallMinor`:
   * re-spread by the next true-up inside the FY, NOT recoverable in the last
   * FY month or the separation month. Omitted: 10000 (no ceiling beyond the
   * protected-net floor -- also the tenant value when
   * payroll_settings.deduction_cap_applies is false). Tenant value:
   * payroll.payroll_settings.max_deduction_share_bps (migration 0165).
   */
  maxDeductionShareBps?: number;
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
  /** The base the NPS 10% / 14% were applied to (Basic + DA, plus the Basic + DA part of arrears). */
  npsPensionBaseMinor: bigint;
  annualTaxableMinor: bigint;
  negativeNet: boolean;
  /** P3: recovery (LOP/EMI/arrears) deferred because it would breach the net floor. */
  recoveryCarryForwardMinor: bigint;
  /**
   * UAT T-PERIOD D-02b (s.192): the FY tax liability this system has to
   * deduct (the annual tax less the part presumed deducted for in-service
   * months with no slip here), the TDS already deducted above it (excess:
   * nothing more is deducted; the employee claims the refund in the return),
   * and the TDS not deducted this month because of the net-pay cap. 0n when
   * there is no run context (preview callers).
   */
  tdsLiabilityMinor: bigint;
  tdsExcessMinor: bigint;
  tdsShortfallMinor: bigint;
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
  // UAT b18 D5 (migration 0162): employer-only EPFO charges, never deducted from the employee.
  edliRateBps: bigint;        // EDLI contribution (A/c 21), e.g. 50n = 0.5% of EDLI wages
  edliWageCapMinor: bigint;   // EDLI wage ceiling, paise (₹15,000 = 1_500_000n) -> max ₹75 per member
  epfAdminRateBps: bigint;    // EPF administrative charges (A/c 2), e.g. 50n = 0.5% of EPF wages
  epfAdminMinMinor: bigint;   // A/c 2 statutory minimum per establishment per wage month, paise (₹500 = 50_000n)
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
  edliRateBps: 50n,
  edliWageCapMinor: 1_500_000n,
  epfAdminRateBps: 50n,
  epfAdminMinMinor: 50_000n,
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
    edliRateBps, edliWageCapMinor, epfAdminRateBps, epfAdminMinMinor,
  } = picked;
  return {
    pfRatePct, pfWageCapMinor, epsRateBps, epsCapMinor, esiWageCapMinor,
    esiEmployeeRateBps, esiEmployerRateBps, sec80cCapMinor, sec80dCapMinor, sec80ccd1bCapMinor,
    edliRateBps, edliWageCapMinor, epfAdminRateBps, epfAdminMinMinor,
  };
}

/** Employer-only EPFO charges on one EPF member slip (UAT b18 D5 / D6). */
export interface EpfEmployerCharges {
  /** The EPF wage the 12% was actually computed on: min(Basic + DA, PF wage ceiling). */
  pfWageMinor: bigint;
  /** EDLI wages: min(Basic + DA, EDLI wage ceiling). */
  edliWageMinor: bigint;
  /** Employer EDLI contribution (A/c 21): EDLI rate x EDLI wages, rounded to the rupee. */
  edliMinor: bigint;
  /** Employer EPF administrative charges (A/c 2) for this member before the establishment minimum. */
  epfAdminMinor: bigint;
}

/**
 * UAT b18 D5 / D6: the EPF wage actually used, and the employer EDLI and EPF
 * admin charges, for an EPF member whose Basic + DA (pension base) is
 * `pensionBaseMinor`. Pure. Kept OUT of computeSlip so its result (and the
 * legacy-oracle proof of it) is unchanged: these are employer cost lines, they
 * never touch gross, deductions or net pay. The A/c 2 statutory minimum applies
 * per establishment per month, so it is applied on the period summary
 * (epfAdminChargeForPeriod), not per member.
 */
/** EPS 1995 para 6A (GSR 609(E), 22.08.2014): the 01.09.2014 cut-off and the EPS wage ceiling (Rs 15,000, statutory, not the configurable PF ceiling). */
export const EPS_CUTOFF_DATE = "2014-09-01";
export const EPS_WAGE_CEILING_MINOR = 1_500_000n;

export interface EpsMembershipFacts {
  /** Date the member first joined EPF anywhere (via the UAN); null = this joining date. */
  firstJoinedOn?: string | null;
  /** Member by joint option under para 26(6) EPF Scheme (wages above the ceiling at joining). */
  voluntaryJointOption?: boolean | null;
  /** Explicit EPS membership recorded by HR; null = derived. */
  epsMember?: boolean | null;
  /** EPF wages (Basic + DA, paise) at first joining EPF, stamped once at enrolment / hire; null = not recorded. */
  joiningWageMinor?: string | number | bigint | null;
  /**
   * Delta review SF1: the member was 58 or older before the wage month began
   * (HRMS computes it per month from the DOB; the DOB itself is never sent).
   */
  ageCutoffReached?: boolean | null;
}

export interface EpsDecision {
  eligible: boolean;
  /** false = no recorded fact decides it; the member is treated as an EPS member and the run raises EPS_ELIGIBILITY_UNRECORDED. */
  recorded: boolean;
}

/**
 * Review SF1 + delta-review blocker (ERP-head decision 2026-11-05): is this EPF
 * member an EPS member for the wage month? Decided ONLY from recorded facts --
 * para 6A tests the wages at FIRST joining EPF, once, and an EPS member stays
 * one when pay later crosses the ceiling, so the current month's wage is never
 * looked at. Pure. In order:
 *   - aged 58 before the month began            -> not eligible (EPS stops at 58;
 *     the birthday month counts in full -- EPFO pro-rates it, not modelled)
 *   - explicit epsMember                         -> as recorded
 *   - para 26(6) joint-option member             -> not eligible
 *   - first in EPF (recorded date, else this joining date) before 01.09.2014 -> eligible
 *   - joining wage recorded                       -> eligible iff <= Rs 15,000
 *   - nothing recorded                            -> ELIGIBLE (the pre-PR behaviour),
 *     recorded: false -- the run flags it (EPS_ELIGIBILITY_UNRECORDED). EPS paid
 *     in error can be moved to A/c 1 on the employer's request; EPS withheld in
 *     error costs the member pension service.
 */
export function epsEligibility(facts: EpsMembershipFacts, dateOfJoining: string): EpsDecision {
  if (facts.ageCutoffReached) return { eligible: false, recorded: true };
  if (facts.epsMember != null) return { eligible: facts.epsMember, recorded: true };
  if (facts.voluntaryJointOption) return { eligible: false, recorded: true };
  const first = facts.firstJoinedOn ?? dateOfJoining;
  if (first < EPS_CUTOFF_DATE) return { eligible: true, recorded: true };
  if (facts.joiningWageMinor != null) return { eligible: BigInt(facts.joiningWageMinor) <= EPS_WAGE_CEILING_MINOR, recorded: true };
  return { eligible: true, recorded: false };
}

/** Delta review: what the tenant does with EPF members whose EPS eligibility is unrecorded. */
export type EpsUnrecordedPolicy = "advisory" | "block";
export const EPS_ELIGIBILITY_UNRECORDED = "EPS_ELIGIBILITY_UNRECORDED";

export function epfEmployerCharges(pensionBaseMinor: bigint, cfg: StatutoryConfig): EpfEmployerCharges {
  const base = pensionBaseMinor > 0n ? pensionBaseMinor : 0n;
  const pfWageMinor = base > cfg.pfWageCapMinor ? cfg.pfWageCapMinor : base;
  const edliWageMinor = base > cfg.edliWageCapMinor ? cfg.edliWageCapMinor : base;
  return {
    pfWageMinor,
    edliWageMinor,
    edliMinor: roundRupee((edliWageMinor * cfg.edliRateBps) / 10000n),
    epfAdminMinor: roundRupee((pfWageMinor * cfg.epfAdminRateBps) / 10000n),
  };
}

/**
 * A/c 2 for a wage month: the sum of the per-member admin charges, raised to
 * the configured statutory minimum when the establishment has at least one
 * EPF member that month (no members: nothing is due).
 */
export function epfAdminChargeForPeriod(sumMemberAdminMinor: bigint, memberCount: number, cfg: StatutoryConfig): bigint {
  if (memberCount <= 0) return 0n;
  return sumMemberAdminMinor < cfg.epfAdminMinMinor ? cfg.epfAdminMinMinor : sumMemberAdminMinor;
}

const GPF_PCT     = 10n;
const NPS_EMP_PCT = 10n;
const NPS_ER_PCT  = 14n;
/**
 * UAT b18 D1: UPS contributions on Basic + DA, per the UPS notification of
 * 24 Jan 2025: employee 10%; Government 18.5% = 10% to the employee's
 * INDIVIDUAL corpus (npsEmployerMinor, the PRAN ledger) + 8.5% to the POOL
 * corpus. ERP-head decision 2026-11-05 (PR #2458): the 8.5% pool share is not
 * credited to the individual account, so it is NOT part of npsEmployerMinor;
 * upsPoolShareMinor() computes it and payroll books it as its own statutory
 * row (statutory.payroll_ups_pool) and its own GL accrual line.
 */
const UPS_EMP_PCT = 10n;
const UPS_ER_INDIVIDUAL_PCT = 10n;
export const UPS_POOL_BPS = 850n;

/** The Government 8.5% UPS pool corpus share on the UPS pension base (Basic + DA), rounded to the rupee. */
export function upsPoolShareMinor(pensionBaseMinor: bigint): bigint {
  return pensionBaseMinor > 0n ? roundRupee((pensionBaseMinor * UPS_POOL_BPS) / 10000n) : 0n;
}
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
    epsEligible = true,
    taxRegime = "new",
    fyStartYear = 2025,
    declaration = {},
    tdsYtdMinor,
    monthsRemaining,
    fyPaidToDate,
    arrearPensionBaseMinor = 0n,
    protectedNetFloorMinor = 0n,
    maxDeductionShareBps = 10000,
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
  // T-STAT F02: every ad-hoc EARNING (arrears, bonus, reimbursements, any
  // one-off line) is paid once -- it is counted once in the annual estimate,
  // never multiplied by the months remaining.
  let oneOffEarningsMinor = 0n;
  for (const c of components) {
    const line = { ...c, amountMinor: roundRupee(c.amountMinor) };
    if (line.type === "earning") oneOffEarningsMinor += line.amountMinor;
    (line.type === "earning" ? earnings : deductions).push(line);
  }

  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);
  const regularGrossMinor = grossMinor - oneOffEarningsMinor;
  const lopMinor = deductions.filter((d) => d.code === "LOP").reduce((s, d) => s + d.amountMinor, 0n);

  // Pension contributions are computed on Basic + DA. FR 53 suspension: only
  // the regular days' Basic + DA (FR 53(2)(ii): no GPF subscription from
  // subsistence allowance -- see subsistence.ts).
  const pensionBase = earningsOverride ? earningsOverride.pensionBaseMinor : basicMinor + daMinor;

  let pfEmployeeMinor = 0n, pfEmployerMinor = 0n, epsMinor = 0n, epfEmployerMinor = 0n;
  let gpfMinor = 0n, npsEmployeeMinor = 0n, npsEmployerMinor = 0n;

  // T-STAT M-NPS: NPS also falls on the Basic + DA part of arrears.
  const npsBaseRaw = pensionBase + arrearPensionBaseMinor;
  const npsPensionBaseMinor = pensionScheme === "NPS" || pensionScheme === "UPS" ? (npsBaseRaw > 0n ? npsBaseRaw : 0n) : 0n;
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
    npsEmployeeMinor = pct(npsPensionBaseMinor, NPS_EMP_PCT);
    npsEmployerMinor = pct(npsPensionBaseMinor, NPS_ER_PCT);
  } else if (pensionScheme === "NONE") {
    // Review SF6: apprentices / consultants -- no pension scheme, no deduction.
  } else if (pensionScheme === "UPS") {
    // UAT b18 D1: UPS is an option under NPS -- same base, same PRAN/CRA
    // ledger, the higher UPS Government share.
    npsEmployeeMinor = pct(npsPensionBaseMinor, UPS_EMP_PCT);
    npsEmployerMinor = pct(npsPensionBaseMinor, UPS_ER_INDIVIDUAL_PCT);
  } else if (statutoryPf) {
    // Engagement gate: no EPF/EPS for a type whose policy excludes provident fund.
    const pfWage    = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    pfEmployeeMinor = pct(pfWage, statutoryConfig.pfRatePct);
    pfEmployerMinor = pct(pfWage, statutoryConfig.pfRatePct);
    const epsWage   = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    epsMinor        = epsEligible ? roundRupee((epsWage * statutoryConfig.epsRateBps) / 10000n) : 0n;
    if (epsMinor > statutoryConfig.epsCapMinor) epsMinor = statutoryConfig.epsCapMinor;
    epfEmployerMinor = pfEmployerMinor - epsMinor;
  }

  // Engagement gate: ESI only when the type's policy allows it AND under the cap.
  const esiApplicable    = statutoryEsi && grossMinor <= statutoryConfig.esiWageCapMinor;
  const esiMinor         = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployeeRateBps) / 10000n) : 0n;
  const esiEmployerMinor = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployerRateBps) / 10000n) : 0n;

  // T-STAT M-PT-BASIS: PT slab on the monthly salary (gross less LOP) when a resolver is given.
  const pt = roundRupee(input.ptForSalaryMinor ? input.ptForSalaryMinor(grossMinor - lopMinor) : ptMinor);
  if (pt > 0n) deductions.push({ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: pt });

  // Monthly TDS (Sec 192) on real annual TAXABLE income: regime-aware, with
  // Sec 16 std deduction + PT, Sec 10(13A) HRA exemption, and Chapter VI-A (old regime).
  //
  // T-STAT F02: the estimate is no longer this month gross x 12. With the FY
  // history (run context) it is the salary actually paid earlier in the FY +
  // this month (less LOP) + regular salary for the months still to come +
  // one-off items once; months in the FY the employee is paid for =
  // fyPaidToDate.months + unrecordedMonths + monthsRemaining (a mid-year
  // joiner gets fewer than 12, which also scales the old-regime HRA exemption
  // and PT below).
  // Without it (preview callers) the regular salary is annualised x 12 and
  // one-offs are still counted once.
  const projected = fyPaidToDate != null && monthsRemaining != null;
  const remaining = BigInt(monthsRemaining != null && monthsRemaining > 1 ? monthsRemaining : 1);
  const declaredPrevSalary = (declaration.prevEmployerSalaryMinor ?? 0n) > 0n;
  const unrecorded = projected && (!declaredPrevSalary || input.presumedMonthsAuthoritative === true) ? BigInt(Math.max(0, fyPaidToDate.unrecordedMonths ?? 0)) : 0n;
  const unrecordedLop = unrecorded > 0n ? (fyPaidToDate?.unrecordedLopMinor ?? 0n) : 0n;
  const annualGross = projected
    ? fyPaidToDate.grossMinor + regularGrossMinor * unrecorded - unrecordedLop
      + (regularGrossMinor - lopMinor) + regularGrossMinor * (remaining - 1n) + oneOffEarningsMinor
    : regularGrossMinor * 12n + oneOffEarningsMinor;
  const fyMonths = projected ? BigInt(fyPaidToDate.months) + unrecorded + remaining : 12n;
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
    const salaryHraAnnual   = (earningsOverride ? earningsOverride.hraSalaryMinor : basicMinor + daMinor) * fyMonths;
    const hraReceivedAnnual = hraMinor * fyMonths;
    const rentAnnual        = declaration.rentPaidAnnualMinor ?? 0n;
    const hraExempt = hraExemptionMinor(salaryHraAnnual, hraReceivedAnnual, rentAnnual, cityClass === "X");
    const d80c = declaration.ded80cMinor ?? 0n; const c80c = d80c > statutoryConfig.sec80cCapMinor ? statutoryConfig.sec80cCapMinor : d80c;
    const d80d = declaration.ded80dMinor ?? 0n; const c80d = d80d > statutoryConfig.sec80dCapMinor ? statutoryConfig.sec80dCapMinor : d80d;
    const other = declaration.otherDedMinor ?? 0n;
    annualTaxableMinor = annualGross + extraIncome - stdDeductionMinor - hraExempt - c80c - c80d - other - pt * fyMonths - ltcExemptTotalMinor;
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
  //
  // UAT T-PERIOD D-02b: in-service months with no slip here are in the
  // estimate at the regular pay (T-STAT F02 / SF1), so the TDS deducted for
  // them -- outside this system -- is presumed at the same monthly rate
  // (s192MonthlyTds). The run previously took the WHOLE year tax from the few
  // months recorded here: March TDS Rs 2,70,847 on gross Rs 2,31,428.
  const s192 = monthsRemaining != null
    ? s192MonthlyTds({                                                             // Sec 192 true-up
      annualTaxMinor, tdsDeductedMinor: tdsYtdMinor ?? 0n, monthsRemaining,
      presumedMonths: unrecorded, fyMonths,
    })
    : { tdsMinor: roundRupee(divRoundBig(annualTaxMinor, 12n)), liabilityMinor: 0n, excessMinor: 0n }; // flat /12 fallback

  // Split ad-hoc deductions into recovery (floor-capped) and fixed (e.g. PT, and
  // any structure-defined deduction). Fixed deductions are not subject to the floor.
  const recoveryRequested = deductions
    .filter((d) => RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);
  const fixedAdHoc = deductions
    .filter((d) => !RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);

  // UAT T-PERIOD D-02b: TDS never exceeds the salary of the month left after
  // the pension / PF / ESI contributions, PT and other fixed deductions and
  // loss of pay, less the protected-net floor, nor takes the deductions above
  // the configured share of gross. Whole rupees, rounded down.
  const otherStatutoryMinor = pfEmployeeMinor + esiMinor + gpfMinor + npsEmployeeMinor;
  // Loss of pay is pay not earned, not a deduction from it: the share is of
  // the salary earned this month (gross less LOP).
  const tdsCapMinor = tdsCapForMonthMinor({
    grossMinor: grossMinor - lopMinor, otherDeductionsMinor: otherStatutoryMinor + fixedAdHoc,
    protectedNetFloorMinor, maxDeductionShareBps,
  });
  const tdsMinor = s192.tdsMinor > tdsCapMinor ? tdsCapMinor : s192.tdsMinor;
  const tdsShortfallMinor = s192.tdsMinor - tdsMinor;

  // Statutory pension/insurance/tax deductions are never floored.
  const statutoryDeductions = otherStatutoryMinor + tdsMinor;

  // Headroom available for recovery after gross less all non-recovery deductions,
  // keeping net at or above the protected floor.
  const nonRecovery   = statutoryDeductions + fixedAdHoc;
  const headroom      = grossMinor - nonRecovery - protectedNetFloorMinor;
  const recoveryCap   = headroom < 0n ? 0n : headroom;
  let recoveryApplied = recoveryRequested > recoveryCap ? recoveryCap : recoveryRequested;
  let recoveryCarryForwardMinor = recoveryRequested - recoveryApplied;

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

  // UAT T-PERIOD D-02b review (PR #2459): the deduction share ceiling binds the
  // recoveries too -- loan EMI / arrear recovery used to be limited only by the
  // protected-net floor, so deductions could reach 96.6% of gross. Statutory
  // deductions (TDS within its own cap), PT and fixed deductions come first;
  // EMI / arrear recovery take only what is left inside maxDeductionShareBps of
  // the salary earned (gross less the loss of pay applied), largest line
  // trimmed first, the rest carried forward. LOP is pay not earned, not a
  // deduction, so it is never trimmed here. With the default 10000 bps this is
  // a no-op (the floor headroom above is already within it).
  {
    const lopApplied = deductions.filter((d) => d.code === "LOP").reduce((s, d) => s + d.amountMinor, 0n);
    const shareBps = BigInt(Math.min(10000, Math.max(0, Math.trunc(maxDeductionShareBps))));
    const shareCeiling = ((grossMinor - lopApplied) * shareBps) / 10000n;
    const allowedRaw = shareCeiling - nonRecovery;
    const allowedOther = allowedRaw > 0n ? allowedRaw : 0n;
    const otherLines = deductions.filter((d) => RECOVERY_CODES.has(d.code) && d.code !== "LOP")
      .sort((a, b) => (a.amountMinor < b.amountMinor ? 1 : -1));
    const otherApplied = otherLines.reduce((s, d) => s + d.amountMinor, 0n);
    if (otherApplied > allowedOther) {
      let excess = otherApplied - allowedOther;
      recoveryApplied -= excess;
      recoveryCarryForwardMinor += excess;
      for (const line of otherLines) {
        if (excess <= 0n) break;
        const trim = line.amountMinor < excess ? line.amountMinor : excess;
        line.amountMinor -= trim;
        excess -= trim;
      }
      for (let i = deductions.length - 1; i >= 0; i--) {
        const d = deductions[i]!;
        if (RECOVERY_CODES.has(d.code) && d.code !== "LOP" && d.amountMinor === 0n) deductions.splice(i, 1);
      }
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
    gpfMinor, npsEmployeeMinor, npsEmployerMinor, npsPensionBaseMinor, annualTaxableMinor, negativeNet,
    tdsLiabilityMinor: s192.liabilityMinor, tdsExcessMinor: s192.excessMinor, tdsShortfallMinor,
  };
}

/**
 * UAT T-PERIOD D-02b -- the s.192 monthly TDS (Income-tax Act s.192(1), (3)):
 *   liability   = annual tax on the FY estimate, less the TDS presumed
 *                 deducted for `presumedMonths` (in-service months with no
 *                 slip here, estimated at the regular pay) at the average
 *                 monthly rate: annual tax x presumed / fyMonths;
 *   monthly TDS = max(0, (liability - TDS deducted so far) / months remaining),
 *                 the whole balance in the last month (March);
 *   excess      = TDS deducted so far above the liability (no further TDS;
 *                 s.192(3) only allows adjusting it within the FY -- the
 *                 employee claims any refund in the return).
 * TDS deducted so far includes previous-employer TDS declared (Form 12B);
 * a declared previous salary replaces the presumed months (presumedMonths 0).
 * Pure.
 */
export function s192MonthlyTds(i: {
  annualTaxMinor: bigint; tdsDeductedMinor: bigint; monthsRemaining: number;
  presumedMonths?: bigint; fyMonths?: bigint;
}): { tdsMinor: bigint; liabilityMinor: bigint; excessMinor: bigint } {
  const fyMonths = i.fyMonths != null && i.fyMonths > 0n ? i.fyMonths : 12n;
  const presumedRaw = i.presumedMonths != null && i.presumedMonths > 0n ? i.presumedMonths : 0n;
  const presumed = presumedRaw > fyMonths ? fyMonths : presumedRaw;
  const annual = i.annualTaxMinor > 0n ? i.annualTaxMinor : 0n;
  // s.288B: the presumed amount is a whole rupee too.
  const presumedTds = presumed > 0n ? roundRupee(divRoundBig(annual * presumed, fyMonths)) : 0n;
  const liabilityMinor = annual - presumedTds;
  const excessMinor = i.tdsDeductedMinor > liabilityMinor ? i.tdsDeductedMinor - liabilityMinor : 0n;
  // PR #2459 review: TDS is rounded to the nearest rupee (s.288B) -- the
  // last-month balance (trueUpTdsMinor m = 1) used to carry paise (33,855.67).
  return { tdsMinor: roundRupee(trueUpTdsMinor(liabilityMinor, i.tdsDeductedMinor, i.monthsRemaining)), liabilityMinor, excessMinor };
}

/**
 * UAT T-PERIOD D-02b: the most TDS a slip can carry -- the salary earned in
 * the month (`grossMinor`: gross less loss of pay) less the other deductions
 * (pension / PF / ESI, PT, fixed deductions) and the protected-net floor, and
 * no more than leaves all deductions within `maxDeductionShareBps` of it.
 * Never negative; whole rupees, rounded down. Pure.
 */
export function tdsCapForMonthMinor(i: { grossMinor: bigint; otherDeductionsMinor: bigint; protectedNetFloorMinor?: bigint; maxDeductionShareBps?: number }): bigint {
  const bps = BigInt(Math.min(10000, Math.max(0, Math.trunc(i.maxDeductionShareBps ?? 10000))));
  const byFloor = i.grossMinor - i.otherDeductionsMinor - (i.protectedNetFloorMinor ?? 0n);
  const byShare = (i.grossMinor * bps) / 10000n - i.otherDeductionsMinor;
  const cap = byFloor < byShare ? byFloor : byShare;
  return cap > 0n ? (cap / 100n) * 100n : 0n;
}

/**
 * T-STAT F02 (s.192): FY months before `runMonth` in which the employee was
 * already in service (from the later of April of the FY and the joining
 * month) but which have no paid slip in this system -- e.g. months paid
 * before go-live. The annual estimate counts them at the current regular
 * salary, as the old x12 estimate implicitly did, while a genuine mid-year
 * joiner (joined this FY) is projected only from the joining month. No
 * joining date known: in service for the whole FY. Pure.
 */
export function unrecordedFyMonths(fyStartYear: number, runMonth: string, dateOfJoining: string | null | undefined, recordedMonths: number): number {
  const idx = (period: string) => { const [y, m] = period.split("-").map(Number) as [number, number]; return y * 12 + (m - 1); };
  const fyStartIdx = fyStartYear * 12 + 3; // April
  const dojIdx = dateOfJoining && /^\d{4}-\d{2}/.test(dateOfJoining) ? idx(dateOfJoining.slice(0, 7)) : fyStartIdx;
  const fromIdx = Math.max(fyStartIdx, dojIdx);
  const inService = Math.max(0, idx(runMonth) - fromIdx);
  return Math.max(0, inService - recordedMonths);
}

/**
 * T-STAT F02 / review SF1: the in-service FY months before `runMonth` (from the
 * later of April and the joining / commencement month) that have no recorded
 * regular slip, as YYYY-MM. Pure.
 */
export function unrecordedFyMonthList(fyStartYear: number, runMonth: string, startDate: string | null | undefined, recordedMonths: readonly string[]): string[] {
  const idx = (period: string) => { const [y, m] = period.split("-").map(Number) as [number, number]; return y * 12 + (m - 1); };
  const fyStartIdx = fyStartYear * 12 + 3;
  const startIdx = startDate && /^\d{4}-\d{2}/.test(startDate) ? idx(startDate.slice(0, 7)) : fyStartIdx;
  const recorded = new Set(recordedMonths);
  const out: string[] = [];
  for (let i = Math.max(fyStartIdx, startIdx); i < idx(runMonth); i++) {
    const period = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    if (!recorded.has(period)) out.push(period);
  }
  return out;
}

/**
 * T-STAT review SF2: the s.192 annual estimate of a pensioner gross -- pension
 * actually paid this FY + the current month pension for the unrecorded
 * in-pension months and for the months remaining (incl. this one). Pure.
 */
export function pensionAnnualGrossEstimateMinor(p: { currentGrossMinor: bigint; fyPaid: { grossMinor: bigint; months: number }; unrecordedMonths: number; monthsRemaining: number }): bigint {
  const remaining = BigInt(Math.max(1, p.monthsRemaining));
  return p.fyPaid.grossMinor + p.currentGrossMinor * (BigInt(Math.max(0, p.unrecordedMonths)) + remaining);
}

/** Earning codes paid once (not regular monthly pay). */
const ONE_OFF_EARNING_CODES = new Set(["ARREAR", "BONUS", "REIMB"]);

export interface ArrearsReviewEmployee {
  employeeId: string; employeeNo: string; arrearsMinor: bigint; regularGrossMinor: bigint; requiresReview: boolean;
}

/**
 * T-STAT review SF4: the arrears paid on a run, per employee, and which need an
 * explicit acknowledgement on approval: arrears above `thresholdBps` of the
 * regular monthly gross (gross less one-off earnings; 10000 = one month). Pure.
 */
export function arrearsReviewOf(
  slips: Array<{ employeeId: string; employeeNo: string; grossMinor: bigint; components?: Array<{ code: string; type: string; amountMinor: number | string | bigint }> | null }>,
  thresholdBps: number,
): { totalArrearsMinor: bigint; employees: ArrearsReviewEmployee[] } {
  const employees: ArrearsReviewEmployee[] = [];
  let total = 0n;
  for (const sl of slips) {
    let arrears = 0n, oneOff = 0n;
    for (const c of sl.components ?? []) {
      if (c.type !== "earning") continue;
      const amt = BigInt(c.amountMinor);
      if (c.code === "ARREAR") arrears += amt;
      if (ONE_OFF_EARNING_CODES.has(c.code)) oneOff += amt;
    }
    if (arrears <= 0n) continue;
    const regular = sl.grossMinor - oneOff;
    total += arrears;
    employees.push({
      employeeId: sl.employeeId, employeeNo: sl.employeeNo, arrearsMinor: arrears, regularGrossMinor: regular,
      requiresReview: arrears * 10000n > (regular > 0n ? regular : 0n) * BigInt(thresholdBps),
    });
  }
  employees.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
  return { totalArrearsMinor: total, employees };
}

/** True when any slip carries an ARREAR earning (the review threshold only needs reading then). Pure. */
export function slipsCarryArrears(slips: Array<{ components?: Array<{ code: string; type: string }> | null }>): boolean {
  return slips.some((sl) => (sl.components ?? []).some((c) => c.type === "earning" && c.code === "ARREAR"));
}

export const ARREARS_REVIEW_REQUIRED = "ARREARS_REVIEW_REQUIRED";
export const INVALID_ZERO_BASIC_EXCLUSION = "INVALID_ZERO_BASIC_EXCLUSION";
/** Default arrears review threshold: arrears above one month of regular gross. */
export const DEFAULT_ARREARS_REVIEW_THRESHOLD_BPS = 10000;

/** An explicit, reasoned acknowledgement of one employee arrears on approval. */
export interface ArrearsAcknowledgement { employeeId: string; reason: string }

/** Arrears that need review and are not acknowledged (with a non-blank reason). Pure. */
export function unacknowledgedArrears(review: { employees: ArrearsReviewEmployee[] }, acks: ArrearsAcknowledgement[] = []): ArrearsReviewEmployee[] {
  const acked = new Set(acks.filter((a) => a.reason.trim().length > 0).map((a) => a.employeeId));
  return review.employees.filter((e) => e.requiresReview && !acked.has(e.employeeId));
}

export function arrearsReviewMessage(employees: ArrearsReviewEmployee[]): string {
  const sample = employees.slice(0, 20).map((e) => `${e.employeeNo} (Rs ${(e.arrearsMinor / 100n).toString()})`).join(", ");
  const more = employees.length > 20 ? ", ..." : "";
  return `${employees.length} employee(s) have arrears above the review threshold: ${sample}${more}. `
    + "Check them and approve with arrearsAcknowledgements [{ employeeId, reason }] for each of them";
}

/**
 * UAT T-PERIOD D-02b (PR #2459 review, ERP-head decision 2026-11-05): default
 * ceiling on a slip total deductions, as a share of the wages earned: 50%,
 * Code on Wages 2019 s.18(2) (which repealed the Payment of Wages Act; under
 * both, income-tax is an authorised deduction inside the limit). Tenant
 * settings payroll.payroll_settings.max_deduction_share_bps and
 * deduction_cap_applies (false: 10000, net-pay floor + acknowledgements only --
 * applicability to regular government servants under FR/SR / CCS awaits legal).
 */
export const DEFAULT_MAX_DEDUCTION_SHARE_BPS = 5000;

/** The ceiling to apply for a tenant: none (10000) when the wage-law cap does not apply. */
export function effectiveDeductionShareBps(settings: { maxDeductionShareBps: number; deductionCapApplies: boolean }): number {
  return settings.deductionCapApplies ? settings.maxDeductionShareBps : 10000;
}

/**
 * PR #2459 review B1 (ERP-head decision 2026-11-05): TDS for in-service FY
 * months with no slip here may only be PRESUMED for months before the later
 * of the tenant payroll go-live date and the employee first slip in this
 * system, and only when no approved opening YTD exists for the FY (the
 * opening YTD is authoritative). A gap AFTER that boundary (a skipped or
 * withheld month) is neither estimated nor presumed: no income, 0 TDS.
 * Months are YYYY-MM. Pure.
 */
export function presumptionBoundaryMonth(goLiveDate: string | null | undefined, firstSlipMonth: string | null | undefined, runMonth: string): string {
  const first = firstSlipMonth && firstSlipMonth < runMonth ? firstSlipMonth : runMonth;
  const live = goLiveDate ? goLiveDate.slice(0, 7) : null;
  return live && live > first ? live : first;
}

/** The month after a YYYY-MM month. Pure. */
export function nextMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function splitUnrecordedMonths(unrecorded: readonly string[], boundaryMonth: string, hasOpeningYtd: boolean): { presumed: string[]; gaps: string[] } {
  if (hasOpeningYtd) return { presumed: [], gaps: [...unrecorded] };
  return { presumed: unrecorded.filter((m) => m < boundaryMonth), gaps: unrecorded.filter((m) => m >= boundaryMonth) };
}

/** PR #2459 review B2: the TDS signals a run must show its approver. */
export const UNRECORDED_FY_MONTHS_ESTIMATED = "UNRECORDED_FY_MONTHS_ESTIMATED";
export const TDS_SHORTFALL_UNRECOVERABLE = "TDS_SHORTFALL_UNRECOVERABLE";

export type TdsReviewKind = "presumed_months" | "excess" | "shortfall" | "recovery_deferred";
export interface TdsReviewItem {
  employeeId: string; employeeNo: string; kind: TdsReviewKind;
  amountMinor: bigint; presumedMonths: number; finalMonth: boolean; requiresAck: boolean;
}

/**
 * The per-employee TDS / deduction signals of a run, from the slip columns
 * (migration 0165). Acknowledgement is required for presumed months and for a
 * TDS shortfall in the last FY month or the separation month (no later
 * true-up exists); an excess and a recovery deferral are shown only. Pure.
 */
export function tdsReviewOf(slips: Array<{ employeeId: string; employeeNo: string; status?: string | null; tdsPresumedMonths?: number | null; tdsExcessMinor?: bigint | null; tdsShortfallMinor?: bigint | null; tdsShortfallFinal?: boolean | null; recoveryDeferredMinor?: bigint | null }>): TdsReviewItem[] {
  const out: TdsReviewItem[] = [];
  for (const sl of slips) {
    if (sl.status === "excluded") continue;
    const base = { employeeId: sl.employeeId, employeeNo: sl.employeeNo };
    if ((sl.tdsPresumedMonths ?? 0) > 0) out.push({ ...base, kind: "presumed_months", amountMinor: 0n, presumedMonths: sl.tdsPresumedMonths ?? 0, finalMonth: false, requiresAck: true });
    if ((sl.tdsExcessMinor ?? 0n) > 0n) out.push({ ...base, kind: "excess", amountMinor: sl.tdsExcessMinor ?? 0n, presumedMonths: 0, finalMonth: false, requiresAck: false });
    if ((sl.tdsShortfallMinor ?? 0n) > 0n) out.push({ ...base, kind: "shortfall", amountMinor: sl.tdsShortfallMinor ?? 0n, presumedMonths: 0, finalMonth: sl.tdsShortfallFinal === true, requiresAck: sl.tdsShortfallFinal === true });
    if ((sl.recoveryDeferredMinor ?? 0n) > 0n) out.push({ ...base, kind: "recovery_deferred", amountMinor: sl.recoveryDeferredMinor ?? 0n, presumedMonths: 0, finalMonth: false, requiresAck: false });
  }
  out.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo) || a.kind.localeCompare(b.kind));
  return out;
}

/** An explicit, reasoned acknowledgement of one employee TDS review items. */
export interface TdsAcknowledgement { employeeId: string; reason: string }

/** The items needing acknowledgement that are not acknowledged (non-blank reason). Pure. */
export function unacknowledgedTds(items: TdsReviewItem[], acks: TdsAcknowledgement[] = []): TdsReviewItem[] {
  const acked = new Set(acks.filter((a) => a.reason.trim().length > 0).map((a) => a.employeeId));
  return items.filter((i) => i.requiresAck && !acked.has(i.employeeId));
}

/** The plain-language text of one TDS review item (also the run warning text). */
export function tdsReviewText(i: TdsReviewItem): string {
  const rs = `Rs ${(i.amountMinor / 100n).toString()}`;
  switch (i.kind) {
    case "presumed_months":
      return `${i.employeeNo}: ${i.presumedMonths} earlier FY month(s) have no slip and no opening YTD; their salary is estimated and their TDS PRESUMED deducted at the average rate. Enter the opening YTD (salary and TDS before go-live / previous employer) to replace the estimate`;
    case "excess":
      return `${i.employeeNo}: TDS deducted this FY exceeds the estimated liability by ${rs}; no TDS is deducted this month. The excess is refundable to the employee through the income-tax return`;
    case "shortfall":
      return i.finalMonth
        ? `${i.employeeNo}: ${rs} of TDS cannot be deducted within the deduction limit (Code on Wages 2019 s.18(2)) and cannot be recovered through payroll this FY -- collect separately or adjust before Form 16`
        : `${i.employeeNo}: ${rs} of TDS is not deducted this month (deduction limit, Code on Wages 2019 s.18(2)); the next month s.192 true-up recomputes it over the months left in the FY, within the same limit`;
    case "recovery_deferred":
      return `${i.employeeNo}: ${rs} of loan / arrear recovery is deferred to keep total deductions within the limit`;
  }
}

export function unacknowledgedTdsCode(items: TdsReviewItem[]): string {
  return items.some((i) => i.kind === "presumed_months") ? UNRECORDED_FY_MONTHS_ESTIMATED : TDS_SHORTFALL_UNRECOVERABLE;
}

export function unacknowledgedTdsMessage(items: TdsReviewItem[]): string {
  const sample = items.slice(0, 10).map(tdsReviewText).join("; ");
  const more = items.length > 10 ? "; ..." : "";
  return `${items.length} TDS item(s) need an acknowledgement before approval: ${sample}${more}. Approve with tdsAcknowledgements [{ employeeId, reason }] for each employee`;
}

/** UAT T-PERIOD D-02b: approval refused while a slip pays nothing (or less than nothing). */
export const NET_PAY_NON_POSITIVE = "NET_PAY_NON_POSITIVE";

/** An explicit, reasoned acknowledgement of one slip with net pay <= 0 on approval. */
export interface NetPayAcknowledgement { employeeId: string; reason: string }

/**
 * UAT T-PERIOD D-02b: the slips of a run whose net pay is <= 0 or whose
 * deductions exceed the gross -- an employee who would be paid nothing. The
 * T-PERIOD March run was approved and disbursed with one (TDS Rs 2,70,847 on
 * gross Rs 2,31,428, net Rs 0). Rs 0-basic slips (their own ZERO_BASIC guard)
 * and excluded slips are not listed. Pure.
 */
export function nonPositiveNetSlipsOf<T extends { employeeId: string; basicMinor: bigint; grossMinor: bigint; totalDeductionsMinor: bigint; netPayMinor: bigint; status?: string | null; components?: Array<{ code: string }> | null }>(slips: T[]): T[] {
  const zeroBasic = new Set(zeroBasicSlipsOf(slips).map((sl) => sl.employeeId));
  return slips.filter((sl) => sl.status !== "excluded" && !zeroBasic.has(sl.employeeId)
    && (sl.netPayMinor <= 0n || sl.totalDeductionsMinor > sl.grossMinor));
}

/** Non-positive-net slips not acknowledged (with a non-blank reason). Pure. */
export function unacknowledgedNonPositiveNet<T extends { employeeId: string }>(slips: T[], acks: NetPayAcknowledgement[] = []): T[] {
  const acked = new Set(acks.filter((a) => a.reason.trim().length > 0).map((a) => a.employeeId));
  return slips.filter((sl) => !acked.has(sl.employeeId));
}

export function nonPositiveNetMessage(slips: Array<{ employeeNo: string; grossMinor: bigint; totalDeductionsMinor: bigint; netPayMinor: bigint }>): string {
  const sample = slips.slice(0, 20).map((sl) => `${sl.employeeNo} (gross Rs ${(sl.grossMinor / 100n).toString()}, deductions Rs ${(sl.totalDeductionsMinor / 100n).toString()}, net Rs ${(sl.netPayMinor / 100n).toString()})`).join(", ");
  const more = slips.length > 20 ? ", ..." : "";
  return `${slips.length} slip(s) in this run pay nothing (net pay <= 0 or deductions above gross): ${sample}${more}. `
    + "Correct the deductions and re-run, or approve with netPayAcknowledgements [{ employeeId, reason }] for each of them";
}

/** Exclusions that do not name a Rs 0-basic slip of the run. Pure. */
export function invalidZeroBasicExclusions(zeroBasic: Array<{ employeeId: string }>, exclusions: ZeroBasicExclusion[] = []): ZeroBasicExclusion[] {
  const zero = new Set(zeroBasic.map((z) => z.employeeId));
  return exclusions.filter((e) => !zero.has(e.employeeId));
}

/** T-STAT M-ZERO: an explicit, reasoned exclusion of one Rs 0-basic slip from the approval guard. */
export interface ZeroBasicExclusion { employeeId: string; reason: string }

/**
 * T-STAT M-ZERO (F05): the Rs 0-basic slips of a run that are NOT explicitly
 * excluded (with a non-blank reason). Approval is refused while any remain. Pure.
 */
export function unexcludedZeroBasicSlips<T extends { employeeId: string }>(zeroBasic: T[], exclusions: ZeroBasicExclusion[] = []): T[] {
  const excluded = new Set(exclusions.filter((e) => e.reason.trim().length > 0).map((e) => e.employeeId));
  return zeroBasic.filter((z) => !excluded.has(z.employeeId));
}

/**
 * T-STAT M-ZERO (F05): the slips of a run with no basic pay (HRMS basic
 * missing). An FR 53 subsistence slip (a SUBSISTENCE_ALLOWANCE line) is not
 * one: its regular-days basic is legitimately 0 for a fully suspended month,
 * and a withheld employee has no slip at all. Pure.
 */
export function zeroBasicSlipsOf<T extends { basicMinor: bigint; components?: Array<{ code: string }> | null }>(slips: T[]): T[] {
  return slips.filter((sl) => sl.basicMinor === 0n && !(sl.components ?? []).some((c) => c.code === "SUBSISTENCE_ALLOWANCE"));
}

export const ZERO_BASIC_SLIPS = "ZERO_BASIC_SLIPS";

export function zeroBasicSlipsMessage(slips: Array<{ employeeNo: string }>): string {
  const sample = slips.slice(0, 20).map((z) => z.employeeNo).join(", ");
  const more = slips.length > 20 ? ", ..." : "";
  return `${slips.length} slip(s) in this run have no basic pay (HRMS basic missing): ${sample}${more}. `
    + "Fix the basic pay in HRMS and re-run, or approve with zeroBasicExclusions [{ employeeId, reason }] for each of them";
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

/**
 * Payroll run lifecycle. UAT L2-N3: "processing" used to mean both "the slips are
 * being computed" and "computed, awaiting approval", so a run could be approved
 * while its computation was still running. "processing" now only ever means the
 * computation is in flight; it ends in "computed" (slips and totals written,
 * ready for review and approval) or "failed". The payroll_runs status CHECK
 * (payroll_runs_status_check_extended, migrations 0027/0047) already allows
 * "computed".
 *
 *   draft -> processing -> computed -> approved (L1) -> disbursed (L2)
 *                       -> failed -> draft (revert)
 *
 * Ways out for an operator (payroll admin, reason >= 10 chars, audited,
 * maker-checker neutral):
 *  - reject / send back: computed -> failed (the computation is wrong, e.g.
 *    no DA rate, Rs 0 basics); the pass is unwound (run-unwind.ts) and a new
 *    run for the period can be created;
 *  - stuck-run recovery: processing -> failed once the run has not been
 *    updated for PAYROLL_STUCK_RUN_HOURS (default 6) -- a computation pass
 *    commits in one transaction, so nothing of a stuck pass was written.
 */
export const RUN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft:      ["processing"],
  processing: ["computed", "failed"],
  computed:   ["approved", "failed"],
  approved:   ["disbursed"],
  disbursed:  [],
  failed:     ["draft"],
};

export const RUN_NOT_READY_FOR_APPROVAL = "RUN_NOT_READY_FOR_APPROVAL";
export const RUN_ALREADY_APPROVED = "RUN_ALREADY_APPROVED";
export const RUN_NOT_READY_FOR_DISBURSEMENT = "RUN_NOT_READY_FOR_DISBURSEMENT";
export const RUN_ALREADY_DISBURSED = "RUN_ALREADY_DISBURSED";
export const RUN_NOT_REVERTIBLE = "RUN_NOT_REVERTIBLE";
export const RUN_NOT_REJECTABLE = "RUN_NOT_REJECTABLE";
export const RUN_NOT_PROCESSING = "RUN_NOT_PROCESSING";
export const RUN_NOT_STUCK = "RUN_NOT_STUCK";

/** Hours a "processing" run must sit without an update before it may be marked failed. */
export const DEFAULT_STUCK_RUN_HOURS = 6;

export function stuckRunHours(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.PAYROLL_STUCK_RUN_HOURS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STUCK_RUN_HOURS;
}

export type RunLifecycleAction = "approve" | "disburse" | "revert" | "reject" | "failStuck";

/** For "failStuck": when the run was last written, the clock, and the threshold. */
export interface StuckRunCheck { updatedAt: Date; now: Date; hours: number }

/**
 * Why `action` may not be taken on a run in `status`, or null when it may.
 * The single rule both commands.ts (synchronous 409) and the consumers (re-
 * checked under the run row lock) apply: approve only from computed, disburse
 * only from approved, revert only from failed.
 */
export function runActionDenial(action: RunLifecycleAction, status: string, stuck?: StuckRunCheck): { code: string; message: string } | null {
  if (action === "reject") {
    if (status === "computed") return null;
    return { code: RUN_NOT_REJECTABLE, message: `only a computed payroll run can be sent back (current status: ${status})` };
  }
  if (action === "failStuck") {
    if (status !== "processing") {
      return { code: RUN_NOT_PROCESSING, message: `only a payroll run stuck in processing can be marked failed (current status: ${status})` };
    }
    if (!stuck) return { code: RUN_NOT_STUCK, message: "the run has no last-update time to judge whether it is stuck" };
    const idleMs = stuck.now.getTime() - stuck.updatedAt.getTime();
    if (idleMs < stuck.hours * 3_600_000) {
      return { code: RUN_NOT_STUCK, message: `this payroll run may still be computing: it was last updated less than ${stuck.hours} hour(s) ago` };
    }
    return null;
  }
  if (action === "approve") {
    if (status === "computed") return null;
    if (status === "approved" || status === "disbursed") {
      return { code: RUN_ALREADY_APPROVED, message: `this payroll run is already ${status}` };
    }
    return {
      code: RUN_NOT_READY_FOR_APPROVAL,
      message: status === "processing"
        ? "this payroll run is still being computed; it can be approved once its status is computed"
        : `a payroll run can only be approved once it is computed (current status: ${status})`,
    };
  }
  if (action === "disburse") {
    if (status === "approved") return null;
    if (status === "disbursed") return { code: RUN_ALREADY_DISBURSED, message: "this payroll run is already disbursed" };
    return { code: RUN_NOT_READY_FOR_DISBURSEMENT, message: `a payroll run can only be disbursed after it is approved (current status: ${status})` };
  }
  if (status === "failed") return null;
  return { code: RUN_NOT_REVERTIBLE, message: `only a failed payroll run can be reverted to draft (current status: ${status})` };
}

/**
 * A computation pass (runCreate, including its M1 resume / redelivery) may only
 * write slips into a run that is being computed, or re-run over one that has
 * finished computing (every employee is then skipped as already computed).
 * Never into an approved, disbursed, failed or draft run.
 */
export function runAcceptsComputation(status: string): boolean {
  return status === "processing" || status === "computed";
}

export function assertRunStatusTransition(current: string, next: string): void {
  if (!(RUN_TRANSITIONS[current] ?? []).includes(next)) {
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

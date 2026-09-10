/**
 * Pure income-tax engine — shared by the tax routes and the payroll run
 * (monthly TDS spread). FY-aware regime slabs, 87A rebate, surcharge + marginal
 * relief, 4% cess, and Sec 288A/288B rounding.
 *
 * P2: slabs / surcharge / rebate / standard-deduction are now CONFIG-DRIVEN and
 * FY-versioned, sourced from `payroll.tax_slab_config` (see loadTaxConfig()).
 * An UNCONFIGURED (regime, FY) raises UnconfiguredFyError instead of silently
 * falling back to a wrong year. Callers must loadTaxConfig() once at boot
 * (worker + HTTP app) before invoking compute paths.
 *
 * DOM-008 (completing #1117): also tenant-overridable, mirroring the
 * platform-default-sentinel + tenant-override pattern PR #1117 built for
 * PF/EPS/ESI/80C/80D (statutory.statutory_config / domain.ts's
 * resolveStatutoryConfig()). Every public function below takes an OPTIONAL
 * trailing `tenantId`, defaulting to PLATFORM_DEFAULT_TENANT_ID — omitting it
 * (every pre-existing caller and test) resolves exactly as before. When a
 * tenantId IS supplied, getTaxConfig() prefers that tenant's own (regime, FY)
 * row and falls back to the platform default's row for the same (regime,
 * FY) — no separate effective-dating is needed here because (regime, FY)
 * IS the effective-dating axis for income-tax slabs.
 */
export const PLATFORM_DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
export interface TaxSlab { from: number; to: number; rate: number }
export type Regime = "old" | "new";

/** A surcharge band: applies `rate` when total income exceeds `above` rupees. */
export interface SurchargeBand { above: number; rate: number }

/** Full per-(regime,FY) tax configuration. */
export interface FyTaxConfig {
  slabs: TaxSlab[];
  stdDeduction: number;        // rupees
  rebateIncomeCap: number;     // 87A: taxable <= cap -> rebate
  rebateMax: number;           // 87A: max rebate (rupees)
  surchargeBands: SurchargeBand[];
}

/** Thrown when a (regime, FY) has no configured slabs - caller must reject, not guess. */
export class UnconfiguredFyError extends Error {
  constructor(public regime: Regime, public startYear: number) {
    super(`no tax configuration for regime '${regime}' FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}; configure payroll.tax_slab_config before computing tax`);
    this.name = "UnconfiguredFyError";
  }
}

// In-memory registry: key `${tenantId}:${regime}:${startYear}` -> FyTaxConfig.
// `tenantId` is always PLATFORM_DEFAULT_TENANT_ID for a platform-default row.
const REGISTRY = new Map<string, FyTaxConfig>();
const key = (tenantId: string, regime: Regime, startYear: number) => `${tenantId}:${regime}:${startYear}`;

/**
 * Register/overwrite a single (tenantId, regime, FY) config (used by the DB
 * loader and tests). `tenantId` defaults to the platform default so every
 * pre-DOM-008 call site (registering the global config) is unchanged.
 */
export function registerTaxConfig(regime: Regime, startYear: number, cfg: FyTaxConfig, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): void {
  REGISTRY.set(key(tenantId, regime, startYear), cfg);
}

/** True once at least one config has been registered. */
export function isTaxConfigLoaded(): boolean {
  return REGISTRY.size > 0;
}

/**
 * Look up config: the tenant's own (regime, FY) row wins if registered, else
 * the platform default's row for that same (regime, FY), else
 * UnconfiguredFyError. Omitting `tenantId` (or passing the platform-default
 * sentinel) looks up only the platform default, byte-identical to pre-DOM-008
 * behaviour.
 */
export function getTaxConfig(regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): FyTaxConfig {
  if (tenantId !== PLATFORM_DEFAULT_TENANT_ID) {
    const tenantCfg = REGISTRY.get(key(tenantId, regime, startYear));
    if (tenantCfg) return tenantCfg;
  }
  const cfg = REGISTRY.get(key(PLATFORM_DEFAULT_TENANT_ID, regime, startYear));
  if (!cfg) throw new UnconfiguredFyError(regime, startYear);
  return cfg;
}

export function slabsFor(regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): TaxSlab[] {
  return getTaxConfig(regime, startYear, tenantId).slabs;
}

export function stdDeduction(regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): number {
  return getTaxConfig(regime, startYear, tenantId).stdDeduction;
}

function slabTax(taxableIncome: number, slabs: TaxSlab[]): { tax: number; breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> } {
  let remaining = taxableIncome, total = 0;
  const breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> = [];
  for (const s of slabs) {
    if (remaining <= 0) break;
    const width = s.to === Infinity ? remaining : s.to - s.from;
    const inSlab = Math.min(remaining, width);
    total += inSlab * s.rate;
    breakdown.push({ slab: s.to === Infinity ? `>${(s.from / 100000).toFixed(0)}L` : `${(s.from / 100000).toFixed(1)}L-${(s.to / 100000).toFixed(1)}L`, taxableAmount: inSlab, tax: Math.round(inSlab * s.rate) });
    remaining -= inSlab;
  }
  return { tax: total, breakdown };
}

function rebate87A(taxableIncome: number, slabTaxAmt: number, cfg: FyTaxConfig): number {
  return taxableIncome <= cfg.rebateIncomeCap ? Math.min(slabTaxAmt, cfg.rebateMax) : 0;
}

function surchargeRate(totalIncome: number, bands: SurchargeBand[]): number {
  let rate = 0;
  for (const b of bands) {
    if (totalIncome > b.above) rate = b.rate;
  }
  return rate;
}

export function computeTax(taxableIncome: number, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID) {
  const cfg = getTaxConfig(regime, startYear, tenantId);
  const slabs = cfg.slabs;
  const { tax: rawSlab, breakdown } = slabTax(taxableIncome, slabs);
  const baseTax = Math.round(rawSlab);
  const rebate = rebate87A(taxableIncome, baseTax, cfg);
  const afterRebate = Math.max(0, baseTax - rebate);
  let surcharge = Math.round(afterRebate * surchargeRate(taxableIncome, cfg.surchargeBands));
  // Marginal relief at each surcharge threshold.
  for (const b of cfg.surchargeBands) {
    const th = b.above;
    if (taxableIncome > th) {
      const slabAtTh = Math.round(slabTax(th, slabs).tax);
      const excess = taxableIncome - th;
      if (afterRebate + surcharge > slabAtTh + excess) surcharge = Math.max(0, slabAtTh + excess - afterRebate);
    }
  }
  const cess = Math.round((afterRebate + surcharge) * 0.04);
  const total = Math.round((afterRebate + surcharge + cess) / 10) * 10;
  return { baseTax, rebate, surcharge, cess, totalTax: total, slabBreakdown: breakdown };
}

/** Monthly TDS (in paise) for a payroll run: project annual taxable, compute tax, spread /12. */
export function monthlyTdsMinor(annualGrossMinor: bigint, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): bigint {
  const annualGrossRupees = Number(annualGrossMinor) / 100;
  const taxable = Math.round(Math.max(0, annualGrossRupees - stdDeduction(regime, startYear, tenantId)) / 10) * 10;
  const annualTax = computeTax(taxable, regime, startYear, tenantId).totalTax;
  const monthlyRupees = Math.round(annualTax / 12);
  return BigInt(monthlyRupees) * 100n;
}

/** Sec 10(13A) HRA exemption (annual, paise) = least of: HRA received, rent - 10% salary, 50%/40% salary. */
export function hraExemptionMinor(salaryAnnualMinor: bigint, hraReceivedAnnualMinor: bigint, rentPaidAnnualMinor: bigint, isMetro: boolean): bigint {
  const a = hraReceivedAnnualMinor;
  const bRaw = rentPaidAnnualMinor - salaryAnnualMinor / 10n;
  const b = bRaw < 0n ? 0n : bRaw;
  const c = isMetro ? salaryAnnualMinor / 2n : (salaryAnnualMinor * 2n) / 5n;
  return [a, b, c].reduce((m, x) => (x < m ? x : m));
}

/** Full annual income tax (paise) from a precomputed ANNUAL TAXABLE income. */
export function annualTaxFromTaxableMinor(annualTaxableMinor: bigint, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): bigint {
  const taxableRupees = Math.round(Math.max(0, Number(annualTaxableMinor) / 100) / 10) * 10; // Sec 288A
  return BigInt(computeTax(taxableRupees, regime, startYear, tenantId).totalTax) * 100n;
}

/** Monthly TDS (paise) from a precomputed ANNUAL TAXABLE income (flat /12). */
export function monthlyTdsFromTaxableMinor(annualTaxableMinor: bigint, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): bigint {
  return annualTaxFromTaxableMinor(annualTaxableMinor, regime, startYear, tenantId) / 100n / 12n * 100n;
}

/**
 * Sec 192 monthly TDS with YTD true-up: spread the balance of the estimated
 * annual tax over the remaining months; the final month deducts the full residual.
 */
export function trueUpTdsMinor(annualTaxMinor: bigint, tdsDeductedYtdMinor: bigint, monthsRemaining: number): bigint {
  const balance = annualTaxMinor - tdsDeductedYtdMinor;
  if (balance <= 0n) return 0n;
  const m = monthsRemaining < 1 ? 1 : monthsRemaining;
  if (m === 1) return balance; // final month: full residual
  const perMonthRupees = Math.round(Number(balance) / 100 / m);
  return BigInt(perMonthRupees) * 100n;
}

export function fyStartYearForMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1; // Apr-Mar FY
}

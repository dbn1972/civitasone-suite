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
 *
 * DOM-014: slab / rebate / surcharge / marginal-relief / cess were previously
 * computed as `Math.round(rupees * floatRate)` — floating-point rupee
 * arithmetic, the same class of bug the finance gl-service comment at
 * `gl/queries.ts:71` warns against ("Number(minor)/100 ... float-precision
 * loss"). computeTax() keeps its existing Number-rupees public signature
 * (every caller — routes.ts, form16.ts, fnf/domain.ts — and the pinned tests
 * in engine-money.test.ts depend on it, and no real (regime, FY) slab table
 * comes close to Number.MAX_SAFE_INTEGER rupees), but every internal step now
 * computes in bigint paise using integer basis-point rates (`bpsOf`) and
 * round-half-up minor-unit rounding (`roundRupeeMinor` / `roundTenRupeesMinor`),
 * so no slab/surcharge/cess amount is ever produced by float multiplication.
 * `monthlyTdsMinor`, `annualTaxFromTaxableMinor` and `trueUpTdsMinor` (which
 * convert bigint paise down to the engine's rupee inputs, or bigint TDS
 * spreads) are converted the same way.
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

// ─────────────────────── DOM-014: exact bigint-minor-unit helpers ───────────────────────

/**
 * A slab/surcharge/cess `rate` (e.g. 0.30, 0.04) as integer basis points
 * (e.g. 3000n, 400n). Config rates are at most 4 decimal digits (percentages
 * to 2dp), so this round-trips exactly — no rate in `payroll.tax_slab_config`
 * or the seeded test fixtures needs finer resolution.
 */
function bpsOf(rate: number): bigint {
  return BigInt(Math.round(rate * 10000));
}

/** Round bigint paise to the nearest rupee (100 paise), half-up, symmetric on sign. */
export function roundRupeeMinor(x: bigint): bigint {
  if (x < 0n) return -roundRupeeMinor(-x);
  return ((x + 50n) / 100n) * 100n;
}

/** Round bigint paise to the nearest 10 rupees (1000 paise) — Sec 288A/288B. */
export function roundTenRupeesMinor(x: bigint): bigint {
  if (x < 0n) return -roundTenRupeesMinor(-x);
  return ((x + 500n) / 1000n) * 1000n;
}

/** Round-half-up bigint division (both operands positive), returned as bigint. */
function divRoundBig(a: bigint, b: bigint): bigint {
  return (a + b / 2n) / b;
}

const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/**
 * Progressive slab tax over `taxableIncomeMinor` (paise), exact bigint
 * arithmetic throughout — no `Math.round(rupees * floatRate)`. Each slab's
 * tax is rounded to the nearest paisa before summing (bigint addition never
 * accumulates error, so this is strictly more precise than the previous
 * float-sum-then-round-once approach), then the total is rounded to the
 * nearest rupee by the caller exactly as before.
 */
function slabTax(taxableIncomeMinor: bigint, slabs: TaxSlab[]): { taxMinor: bigint; breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> } {
  let remaining = taxableIncomeMinor, totalMinor = 0n;
  const breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> = [];
  for (const s of slabs) {
    if (remaining <= 0n) break;
    const fromMinor = BigInt(s.from) * 100n;
    const widthMinor = s.to === Infinity ? remaining : BigInt(s.to) * 100n - fromMinor;
    const inSlabMinor = minBig(remaining, widthMinor);
    const bps = bpsOf(s.rate);
    const slabTaxMinor = divRoundBig(inSlabMinor * bps, 10000n);
    totalMinor += slabTaxMinor;
    breakdown.push({
      slab: s.to === Infinity ? `>${(s.from / 100000).toFixed(0)}L` : `${(s.from / 100000).toFixed(1)}L-${(s.to / 100000).toFixed(1)}L`,
      taxableAmount: Number(inSlabMinor / 100n),
      tax: Number(roundRupeeMinor(slabTaxMinor) / 100n),
    });
    remaining -= inSlabMinor;
  }
  return { taxMinor: totalMinor, breakdown };
}

function rebate87A(taxableIncomeMinor: bigint, baseTaxMinor: bigint, cfg: FyTaxConfig): bigint {
  return taxableIncomeMinor <= BigInt(cfg.rebateIncomeCap) * 100n
    ? minBig(baseTaxMinor, BigInt(cfg.rebateMax) * 100n)
    : 0n;
}

/** Highest applicable surcharge rate (as bigint basis points) for total income. */
function surchargeRateBps(totalIncomeMinor: bigint, bands: SurchargeBand[]): bigint {
  let bps = 0n;
  for (const b of bands) {
    if (totalIncomeMinor > BigInt(b.above) * 100n) bps = bpsOf(b.rate);
  }
  return bps;
}

export function computeTax(taxableIncome: number, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID) {
  const cfg = getTaxConfig(regime, startYear, tenantId);
  const slabs = cfg.slabs;
  const taxableIncomeMinor = BigInt(Math.round(taxableIncome)) * 100n;

  const { taxMinor: rawSlabMinor, breakdown } = slabTax(taxableIncomeMinor, slabs);
  const baseTaxMinor = roundRupeeMinor(rawSlabMinor);
  const rebateMinor = rebate87A(taxableIncomeMinor, baseTaxMinor, cfg);
  const afterRebateMinor = maxBig(0n, baseTaxMinor - rebateMinor);
  let surchargeMinor = roundRupeeMinor(divRoundBig(afterRebateMinor * surchargeRateBps(taxableIncomeMinor, cfg.surchargeBands), 10000n));

  // Marginal relief at each surcharge threshold.
  for (const b of cfg.surchargeBands) {
    const thMinor = BigInt(b.above) * 100n;
    if (taxableIncomeMinor > thMinor) {
      const slabAtThMinor = roundRupeeMinor(slabTax(thMinor, slabs).taxMinor);
      const excessMinor = taxableIncomeMinor - thMinor;
      if (afterRebateMinor + surchargeMinor > slabAtThMinor + excessMinor) {
        surchargeMinor = maxBig(0n, slabAtThMinor + excessMinor - afterRebateMinor);
      }
    }
  }

  const cessMinor = roundRupeeMinor(divRoundBig((afterRebateMinor + surchargeMinor) * 400n, 10000n)); // 4% cess
  const totalMinor = roundTenRupeesMinor(afterRebateMinor + surchargeMinor + cessMinor);

  return {
    baseTax: Number(baseTaxMinor / 100n),
    rebate: Number(rebateMinor / 100n),
    surcharge: Number(surchargeMinor / 100n),
    cess: Number(cessMinor / 100n),
    totalTax: Number(totalMinor / 100n),
    slabBreakdown: breakdown,
  };
}

/** Monthly TDS (in paise) for a payroll run: project annual taxable, compute tax, spread /12. */
export function monthlyTdsMinor(annualGrossMinor: bigint, regime: Regime, startYear: number, tenantId: string = PLATFORM_DEFAULT_TENANT_ID): bigint {
  const stdDeductionMinor = BigInt(stdDeduction(regime, startYear, tenantId)) * 100n;
  const taxableMinor = roundTenRupeesMinor(maxBig(0n, annualGrossMinor - stdDeductionMinor));
  const taxable = Number(taxableMinor / 100n);
  const annualTaxMinor = BigInt(computeTax(taxable, regime, startYear, tenantId).totalTax) * 100n;
  const monthlyMinor = roundRupeeMinor(divRoundBig(annualTaxMinor, 12n));
  return monthlyMinor;
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
  const taxableMinor = roundTenRupeesMinor(maxBig(0n, annualTaxableMinor)); // Sec 288A
  const taxableRupees = Number(taxableMinor / 100n);
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
  return roundRupeeMinor(divRoundBig(balance, BigInt(m)));
}

export function fyStartYearForMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1; // Apr-Mar FY
}

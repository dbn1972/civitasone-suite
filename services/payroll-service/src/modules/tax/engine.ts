/**
 * Pure income-tax engine (no DB) — shared by the tax routes and the payroll run
 * (monthly TDS spread). FY-aware regime slabs, 87A rebate, surcharge + marginal
 * relief, 4% cess, and Sec 288A/288B rounding.
 */
export interface TaxSlab { from: number; to: number; rate: number }
export type Regime = "old" | "new";

const NEW_REGIME_BY_FY: Record<number, TaxSlab[]> = {
  2024: [
    { from: 0, to: 300000, rate: 0 }, { from: 300000, to: 700000, rate: 0.05 },
    { from: 700000, to: 1000000, rate: 0.10 }, { from: 1000000, to: 1200000, rate: 0.15 },
    { from: 1200000, to: 1500000, rate: 0.20 }, { from: 1500000, to: Infinity, rate: 0.30 },
  ],
  2025: [
    { from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 0.05 },
    { from: 800000, to: 1200000, rate: 0.10 }, { from: 1200000, to: 1600000, rate: 0.15 },
    { from: 1600000, to: 2000000, rate: 0.20 }, { from: 2000000, to: 2400000, rate: 0.25 },
    { from: 2400000, to: Infinity, rate: 0.30 },
  ],
};

const OLD_REGIME_SLABS: TaxSlab[] = [
  { from: 0, to: 250000, rate: 0 }, { from: 250000, to: 500000, rate: 0.05 },
  { from: 500000, to: 1000000, rate: 0.20 }, { from: 1000000, to: Infinity, rate: 0.30 },
];

export function slabsFor(regime: Regime, startYear: number): TaxSlab[] {
  if (regime === "old") return OLD_REGIME_SLABS;
  return NEW_REGIME_BY_FY[startYear] ?? NEW_REGIME_BY_FY[2025] ?? OLD_REGIME_SLABS;
}

export function stdDeduction(regime: Regime): number {
  return regime === "new" ? 75000 : 50000;
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

function rebate87A(taxableIncome: number, slabTaxAmt: number, regime: Regime, startYear: number): number {
  if (regime === "old") return taxableIncome <= 500000 ? Math.min(slabTaxAmt, 12500) : 0;
  if (startYear >= 2025) return taxableIncome <= 1200000 ? Math.min(slabTaxAmt, 60000) : 0;
  return taxableIncome <= 700000 ? Math.min(slabTaxAmt, 25000) : 0;
}

function surchargeRate(totalIncome: number, regime: Regime): number {
  if (totalIncome <= 5000000) return 0;
  if (totalIncome <= 10000000) return 0.10;
  if (totalIncome <= 20000000) return 0.15;
  if (totalIncome <= 50000000) return 0.25;
  return regime === "new" ? 0.25 : 0.37;
}

export function computeTax(taxableIncome: number, regime: Regime, startYear: number) {
  const slabs = slabsFor(regime, startYear);
  const { tax: rawSlab, breakdown } = slabTax(taxableIncome, slabs);
  const baseTax = Math.round(rawSlab);
  const rebate = rebate87A(taxableIncome, baseTax, regime, startYear);
  const afterRebate = Math.max(0, baseTax - rebate);
  let surcharge = Math.round(afterRebate * surchargeRate(taxableIncome, regime));
  for (const th of [5000000, 10000000, 20000000, 50000000]) {
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
export function monthlyTdsMinor(annualGrossMinor: bigint, regime: Regime, startYear: number): bigint {
  const annualGrossRupees = Number(annualGrossMinor) / 100;
  const taxable = Math.round(Math.max(0, annualGrossRupees - stdDeduction(regime)) / 10) * 10;
  const annualTax = computeTax(taxable, regime, startYear).totalTax;
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

/** Monthly TDS (paise) from a precomputed ANNUAL TAXABLE income (after all exemptions/deductions). */
export function monthlyTdsFromTaxableMinor(annualTaxableMinor: bigint, regime: Regime, startYear: number): bigint {
  const taxableRupees = Math.round(Math.max(0, Number(annualTaxableMinor) / 100) / 10) * 10; // Sec 288A
  const annualTax = computeTax(taxableRupees, regime, startYear).totalTax;
  return BigInt(Math.round(annualTax / 12)) * 100n;
}

export function fyStartYearForMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1; // Apr-Mar FY
}

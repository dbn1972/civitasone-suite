/**
 * BoQ domain logic — pure functions for quantity calculation,
 * recapitulation, and BoQ freeze rules.
 */

export interface RecapCharges {
  contingencyPercent: number;
  turnoverTaxPercent: number;
  workChargePercent: number;
  qualityControlPercent: number;
  centagePercent: number;
  otherCharges: bigint;
}

/**
 * Calculate BoQ item amount: rate × quantity.
 * Rate is in paise, quantity is a decimal number.
 * Result rounds to nearest paise.
 */
export function calculateBoqAmount(rate: bigint, quantity: number): bigint {
  // Multiply rate by quantity (using fixed-point: quantity * 10000, then divide)
  const quantityScaled = BigInt(Math.round(quantity * 10000));
  return (rate * quantityScaled) / 10000n;
}

/**
 * Calculate quantity from dimensions: N × L × B × D.
 * Any zero or missing dimension defaults to 1.
 */
export function calculateFromDimensions(n: number, l: number, b: number, d: number): number {
  const nv = n || 1;
  const lv = l || 1;
  const bv = b || 1;
  const dv = d || 1;
  return nv * lv * bv * dv;
}

/**
 * Calculate recapitulation grand total.
 * grandTotal = workAmount + contingency + turnoverTax + workCharge + qualityControl + centage + otherCharges
 */
export function calculateRecapitulation(workAmount: bigint, charges: RecapCharges): bigint {
  const contingency = (workAmount * BigInt(Math.round(charges.contingencyPercent * 100))) / 10000n;
  const turnoverTax = (workAmount * BigInt(Math.round(charges.turnoverTaxPercent * 100))) / 10000n;
  const workCharge = (workAmount * BigInt(Math.round(charges.workChargePercent * 100))) / 10000n;
  const qualityControl = (workAmount * BigInt(Math.round(charges.qualityControlPercent * 100))) / 10000n;
  const centage = (workAmount * BigInt(Math.round(charges.centagePercent * 100))) / 10000n;

  return workAmount + contingency + turnoverTax + workCharge + qualityControl + centage + charges.otherCharges;
}

/** One line of the recapitulation breakdown: a component, how it is derived
 * (its basis), the rate applied (percent, or null for flat ₹ lines) and the
 * resulting paise amount. */
export interface RecapLine {
  key: string;
  label: string;
  basis: "work_amount" | "flat";
  ratePercent: number | null;
  amountMinor: bigint;
}

/**
 * GAP-WORKS-BOQ-WORKID-01: the per-component rupee breakdown behind the recap
 * grand total, so a reviewer can see HOW the Grand Total is derived rather than
 * reading bare percentages next to flat ₹ figures. Each %-line is a percentage
 * OF the work amount (the basis), computed with the exact same bigint formula
 * calculateRecapitulation uses, so the displayed line amounts sum back to the
 * same Grand Total. Order of application is additive — every component is taken
 * on the base work amount, not compounded — so the order of these lines does
 * not change the total; the FE footnote states this explicitly.
 */
export function recapitulationBreakdown(
  workAmount: bigint,
  charges: RecapCharges,
): { lines: RecapLine[]; grandTotal: bigint } {
  const pctLine = (key: string, label: string, pct: number): RecapLine => ({
    key,
    label,
    basis: "work_amount",
    ratePercent: pct,
    amountMinor: (workAmount * BigInt(Math.round(pct * 100))) / 10000n,
  });
  const lines: RecapLine[] = [
    { key: "workAmount", label: "Work Amount", basis: "flat", ratePercent: null, amountMinor: workAmount },
    pctLine("contingency", "Contingency", charges.contingencyPercent),
    pctLine("turnoverTax", "Turnover Tax", charges.turnoverTaxPercent),
    pctLine("workCharge", "Work Charge", charges.workChargePercent),
    pctLine("qualityControl", "Quality Control", charges.qualityControlPercent),
    pctLine("centage", "Centage", charges.centagePercent),
    { key: "otherCharges", label: "Other Charges", basis: "flat", ratePercent: null, amountMinor: charges.otherCharges },
  ];
  const grandTotal = lines.reduce((sum, l) => sum + l.amountMinor, 0n);
  return { lines, grandTotal };
}

/**
 * BR-015: BoQ cannot be modified once tender details exist.
 */
export function canModifyBoq(hasTenderDetails: boolean): boolean {
  return !hasTenderDetails;
}

/**
 * BR-013: BoQ entry requires TS to exist (finalized).
 */
export function canEnterBoq(tsExists: boolean): boolean {
  return tsExists;
}

/** Normalised duplicate key: itemCode when present, else lower-cased description. */
export function boqLineKey(itemCode: string | null | undefined, itemDescription: string): string {
  const code = itemCode?.trim();
  if (code) return code.toLowerCase();
  return itemDescription.trim().toLowerCase();
}

export interface BoqLineRef {
  workId: string;
  itemCode: string | null;
  itemDescription: string;
}

/**
 * BR-016: reject duplicate BoQ lines for the same work (same item code or description key).
 */
export function isDuplicateBoqLine(
  existing: BoqLineRef[],
  workId: string,
  itemCode: string | null | undefined,
  itemDescription: string,
): boolean {
  const key = boqLineKey(itemCode, itemDescription);
  return existing.some(
    (row) => row.workId === workId && boqLineKey(row.itemCode, row.itemDescription) === key,
  );
}

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

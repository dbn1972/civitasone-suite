/**
 * Pure campaign ROI maths (MK-004).
 *
 * ROI is returned in BASIS POINTS as a bigint (1 bp = 0.01%), never as a float:
 * a percentage double would silently round large paise figures. 100% ROI =
 * 10000n bp.
 *
 * All inputs are bigint MINOR units (paise).
 */

/** Basis points per whole unit (100% = 10000 bp). */
export const BPS_SCALE = 10_000n;

/**
 * Sentinel returned when cost is zero: ROI is mathematically undefined (division
 * by zero), and coercing it to 0 or Infinity would misreport a free campaign as
 * break-even or infinitely profitable. Callers must handle `null` explicitly.
 */
export const ROI_UNDEFINED = null;

export type RoiBasisPoints = bigint | typeof ROI_UNDEFINED;

/**
 * ROI in basis points = (revenue - cost) / cost * 10000.
 *
 * Integer division truncates toward zero, so the value is the conservative
 * (magnitude-not-inflated) basis-point figure.
 *
 * @returns bigint basis points, or {@link ROI_UNDEFINED} when cost is zero.
 */
export function computeRoi(costMinor: bigint, revenueMinor: bigint): RoiBasisPoints {
  if (costMinor === 0n) return ROI_UNDEFINED;
  return ((revenueMinor - costMinor) * BPS_SCALE) / costMinor;
}

/** Net profit in minor units. Negative when the campaign lost money. */
export function computeNetMinor(costMinor: bigint, revenueMinor: bigint): bigint {
  return revenueMinor - costMinor;
}

/**
 * Cost per response in minor units, truncated. Returns null when there were no
 * responses (undefined, not zero — nobody responded, so there is no unit cost).
 */
export function costPerResponse(costMinor: bigint, responses: number): bigint | null {
  if (!Number.isInteger(responses) || responses <= 0) return null;
  return costMinor / BigInt(responses);
}

/** Formats basis points for display, e.g. 12345n → "123.45". */
export function formatBasisPoints(bps: RoiBasisPoints): string | null {
  if (bps === ROI_UNDEFINED) return null;
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

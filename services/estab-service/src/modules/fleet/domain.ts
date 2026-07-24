/**
 * Fleet domain logic — pure functions, no IO.
 * Mileage calculation, utilisation metrics, expiry checks.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Compute mileage (km per litre) from fuel log + odometer readings.
 * Returns null if data insufficient (first fill or odometer not advancing).
 */
export function computeMileage(
  previousOdometer: number,
  currentOdometer: number,
  litres: number,
): number | null {
  if (litres <= 0) return null;
  const distance = currentOdometer - previousOdometer;
  if (distance <= 0) return null;
  return Math.round((distance / litres) * 100) / 100;
}

/**
 * Compute monthly utilisation percentage.
 * utilisation = (days with trips / total days in period) * 100
 */
export function computeUtilisation(tripDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.round((tripDays / totalDays) * 10000) / 100;
}

/**
 * Compute running cost per km in paise.
 * running_cost_per_km = total_fuel_cost_paise / total_km
 */
export function computeRunningCostPerKm(totalFuelMinor: bigint, totalKm: number): bigint {
  if (totalKm <= 0) return 0n;
  return totalFuelMinor / BigInt(totalKm);
}

/**
 * Check if a document is about to expire (within reminderDays).
 */
export function isExpiringWithin(validUntil: string, reminderDays: number): boolean {
  const expiry = new Date(validUntil);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / 86_400_000;
  return diffDays >= 0 && diffDays <= reminderDays;
}

/**
 * Validate odometer progression — new reading must be ≥ previous.
 */
export function assertOdometerProgression(previous: number, current: number): void {
  if (current < previous) {
    throw new DomainError("ODOMETER_REGRESSION", `new odometer ${current} < previous ${previous}`);
  }
}

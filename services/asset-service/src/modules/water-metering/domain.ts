export function validateMeterReading(previous: string, current: string): void {
  if (parseFloat(current) < parseFloat(previous)) {
    throw new Error(`Current reading (${current}) cannot be less than previous reading (${previous})`);
  }
}

/**
 * Water bill amount, in integer MINOR units (paise).
 *
 * Units (from the schema and the consumer): `ratePerKlMinor` is paise per kilolitre; `consumptionKl` is kilolitres and
 * may be fractional (a meter reads 30.5 kL). Consumption is taken to litre precision (3 decimals; the billing unit
 * below that does not exist), converted to an integer number of litres, and the amount is computed in bigint:
 *
 *   amountMinor = round-half-up(litres * ratePerKlMinor / 1000)
 *
 * so no float ever touches money (BigInt(30.5) used to throw a RangeError and the bill was never generated).
 * Tax is 18% of the amount, truncated to a whole paisa as before; total = amount + tax.
 */
export function calculateBillAmount(consumptionKl: number, ratePerKlMinor: bigint): { amountMinor: bigint; taxMinor: bigint; totalMinor: bigint } {
  if (!Number.isFinite(consumptionKl) || consumptionKl < 0) {
    throw new RangeError(`consumptionKl must be a finite, non-negative number, got ${consumptionKl}`);
  }
  if (ratePerKlMinor < 0n) throw new RangeError(`ratePerKlMinor must not be negative, got ${ratePerKlMinor}`);
  const litres = BigInt(Math.round(consumptionKl * 1000));
  const amountMinor = (litres * ratePerKlMinor + 500n) / 1000n;
  const taxMinor = amountMinor * 18n / 100n;
  const totalMinor = amountMinor + taxMinor;
  return { amountMinor, taxMinor, totalMinor };
}

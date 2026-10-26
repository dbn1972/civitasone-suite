export function validateMeterReading(previous: string, current: string): void {
  if (parseFloat(current) < parseFloat(previous)) {
    throw new Error(`Current reading (${current}) cannot be less than previous reading (${previous})`);
  }
}

export function calculateBillAmount(consumptionKl: number, ratePerKlMinor: bigint): { amountMinor: bigint; taxMinor: bigint; totalMinor: bigint } {
  const amountMinor = BigInt(consumptionKl) * ratePerKlMinor;
  const taxMinor = amountMinor * 18n / 100n;
  const totalMinor = amountMinor + taxMinor;
  return { amountMinor, taxMinor, totalMinor };
}

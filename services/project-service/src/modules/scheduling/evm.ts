/**
 * Earned Value Management (EVM) — pure domain logic.
 *
 * Computes project performance metrics:
 * - PV (Planned Value): budgeted cost of work scheduled — bigint paise
 * - EV (Earned Value): budgeted cost of work performed — bigint paise
 * - AC (Actual Cost): actual cost of work performed — bigint paise
 * - SPI (Schedule Performance Index): EV/PV (4 decimal places)
 * - CPI (Cost Performance Index): EV/AC (4 decimal places)
 *
 * Division by zero yields null for the respective index.
 */

export interface EvmMetrics {
  pv: bigint;
  ev: bigint;
  ac: bigint;
  spi: number | null;
  cpi: number | null;
}

/**
 * Computes EVM metrics from PV, EV, and AC values (all bigint paise).
 *
 * SPI = EV / PV (4 decimal places via `Number(ev * 10000n / pv) / 10000`)
 * CPI = EV / AC (4 decimal places via `Number(ev * 10000n / ac) / 10000`)
 *
 * When PV is 0 → SPI is null (avoid division by zero).
 * When AC is 0 → CPI is null (avoid division by zero).
 */
export function computeEvm(pv: bigint, ev: bigint, ac: bigint): EvmMetrics {
  const spi: number | null = pv === 0n ? null : Number(ev * 10000n / pv) / 10000;
  const cpi: number | null = ac === 0n ? null : Number(ev * 10000n / ac) / 10000;

  return { pv, ev, ac, spi, cpi };
}

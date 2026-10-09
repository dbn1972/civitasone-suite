/**
 * GAP2-PROCUREMENT-THREEWAYMATCH-01 — invoice money conversion at the
 * POST /v1/procurement/matches/invoice boundary.
 *
 * The invoice amount/tax feed the three-way-match variance that gates vendor
 * payment, so they must be converted to paise with EXACT integer arithmetic.
 * The pre-fix code did `Math.round((invoiceAmount + invoiceTax) * 100)` on
 * two rupees floats — the exact `Number(x) * 100` pattern CLAUDE.md §11 bans
 * (it mis-rounds values like 0.07 and anything above 2^53, and silently
 * rounds 3-decimal input instead of rejecting it). This mirrors the web
 * money lib's `rupeesToMinorString`: parse the rupees decimal STRING with no
 * float math, reject anything with more than 2 fractional digits.
 */

/**
 * Parse a clerk-entered RUPEES decimal string into a paise (minor-unit) bigint,
 * with no floating-point math. Rejects (returns null) on:
 *   - non-numeric input
 *   - negative amounts
 *   - more than 2 fractional digits (cannot be represented exactly in paise)
 * Zero is allowed (a nil tax line is legitimate).
 *
 *   rupeesStringToMinor("0.07")        -> 7n
 *   rupeesStringToMinor("81234567.89") -> 8123456789n
 *   rupeesStringToMinor("100")         -> 10000n
 *   rupeesStringToMinor("1.005")       -> null  (>2 decimals)
 *   rupeesStringToMinor("abc")         -> null
 *   rupeesStringToMinor("-5")          -> null
 */
export function rupeesStringToMinor(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, wholePart, fracPart = ""] = match;
  return BigInt(`${wholePart}${fracPart.padEnd(2, "0")}`);
}

/**
 * Sum invoice amount + tax (both rupees decimal strings) into a paise bigint,
 * or null if EITHER is invalid. BigInt end to end — never float accumulation.
 */
export function invoiceTotalMinor(amount: string, tax: string): bigint | null {
  const amountMinor = rupeesStringToMinor(amount);
  if (amountMinor === null) return null;
  const taxMinor = rupeesStringToMinor(tax);
  if (taxMinor === null) return null;
  return amountMinor + taxMinor;
}

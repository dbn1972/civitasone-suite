/**
 * Convert a clerk-entered rupees decimal string (e.g. from a money input) into a
 * minor-unit (paise) integer string, without floating-point rounding error.
 *
 * Never uses `Number(...) * 100` — float multiplication mis-rounds values like
 * 1.005 (1.005 * 100 === 100.49999999999999 in IEEE-754 doubles). Instead this
 * parses the string directly: splits on ".", pads a short (0 or 1 digit)
 * fractional part out to exactly 2 digits, and concatenates whole + fractional
 * digits into an integer string.
 *
 * Rejects rather than guesses on anything ambiguous or invalid:
 *  - non-numeric input
 *  - negative amounts (money-in/out amounts here are always positive magnitudes)
 *  - more than 2 fractional digits (a value like "1.005" cannot be represented
 *    exactly in paise — reject it instead of silently rounding a payment amount)
 *  - zero or empty amounts
 *
 *   rupeesToMinorString("150.50") -> "15050"
 *   rupeesToMinorString("100")    -> "10000"
 *   rupeesToMinorString("0.1")    -> "10"
 *   rupeesToMinorString("0.10")   -> "10"
 *   rupeesToMinorString("1234.5") -> "123450"
 *   rupeesToMinorString("1.005")  -> null   (more than 2 decimal places)
 *   rupeesToMinorString("abc")    -> null
 *   rupeesToMinorString("-5")     -> null
 *   rupeesToMinorString("0")      -> null   (not a positive amount)
 */
export function rupeesToMinorString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Whole rupees, optionally followed by "." and 1-2 fractional digits. No sign,
  // no exponent, no thousands separators — the clerk types a plain decimal.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;

  const [, wholePart, fracPart = ""] = match;
  const paddedFrac = fracPart.padEnd(2, "0");
  const combined = `${wholePart}${paddedFrac}`;
  // Strip leading zeros (BigInt would do this anyway) but guard against "".
  const minor = BigInt(combined);
  if (minor <= 0n) return null;
  return minor.toString();
}

/**
 * Convert a clerk-entered percentage string (e.g. a tax or discount rate) into
 * a basis-points integer (1% = 100 bps), without floating-point rounding error.
 *
 * Mirrors rupeesToMinorString: it parses the string directly rather than doing
 * `Number(pct) * 100` (which mis-rounds values like 5.55). A percentage carries
 * at most 2 decimal places to land on a whole basis point — anything finer
 * (e.g. "5.555" → 555.5 bps) is rejected instead of silently rounded, so a
 * fabricated rate never reaches the persisted total.
 *
 * Zero is allowed (a 0% tax line is valid); negatives and non-numeric input are
 * rejected. Callers that need a strictly-positive rate (e.g. a discount) check
 * `>0` themselves.
 *
 *   percentToBps("18")    -> 1800
 *   percentToBps("12.5")  -> 1250
 *   percentToBps("5.55")  -> 555
 *   percentToBps("0")     -> 0
 *   percentToBps("5.555") -> null   (more than 2 decimal places)
 *   percentToBps("-1")    -> null
 *   percentToBps("abc")   -> null
 */
export function percentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, wholePart, fracPart = ""] = match;
  const paddedFrac = fracPart.padEnd(2, "0");
  const bps = Number(`${wholePart}${paddedFrac}`);
  return Number.isFinite(bps) ? bps : null;
}

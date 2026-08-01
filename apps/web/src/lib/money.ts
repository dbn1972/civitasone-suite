/**
 * String-safe rupee → paise conversion for clerk-entered money amounts.
 *
 * Money must never round-trip through IEEE-754 floats: `Math.round(1.005 * 100)`
 * evaluates to `100`, not `101`, because `1.005` cannot be represented exactly
 * as a double (it's actually stored as ~1.00499999999999989...). The old
 * `Math.round(Number(v) * 100)` pattern used across the revenue forms was
 * therefore silently mis-rounding some paise amounts.
 *
 * This function does no floating-point arithmetic at all: it splits the input
 * string on "." and concatenates the fractional part (padded/truncated to
 * exactly 2 digits) onto the whole part as plain string manipulation, then
 * strips leading zeros. It rejects (returns null) anything that isn't a
 * plain non-negative decimal with at most 2 decimal places, and rejects a
 * zero amount (not a valid amount to submit).
 */
export function rupeesToMinorString(input: string): string | null {
  const trimmed = input.trim();
  // Digits, optionally a "." followed by 1 or 2 digits. No sign, no
  // exponent, no thousands separators, no more than 2 decimal places.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePartRaw, fracPartRaw = ""] = trimmed.split(".");
  const fracPart = fracPartRaw.padEnd(2, "0").slice(0, 2);
  const wholePart = wholePartRaw.replace(/^0+(?=\d)/, "");

  const minor = `${wholePart}${fracPart}`.replace(/^0+(?=\d)/, "");

  if (/^0+$/.test(minor)) return null; // zero is not a valid amount to submit

  return minor;
}

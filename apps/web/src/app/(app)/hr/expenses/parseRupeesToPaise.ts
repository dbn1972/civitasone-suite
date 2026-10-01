/**
 * Parses a user-typed rupee amount string (e.g. "1234.56") into an integer
 * number of paise, without ever performing a floating-point multiplication
 * or division on the value.
 *
 * GAP-HR-EXPENSES-02 explicitly calls out avoiding the pattern hr/advances'
 * RequestAdvanceForm.tsx uses for its own amount field --
 * `Math.round(Number(rupees) * 100)` -- in favor of a proper string parser.
 * Checked empirically (brute-forced every 2-decimal value from ₹0.00 to
 * ₹200,000.99): that pattern does not actually mis-round any of those values
 * for amounts in a plausible expense-claim range -- `Math.round` absorbs the
 * IEEE-754 representation noise every time. The reasons to still avoid it
 * are structural, not "it's currently producing a wrong stored value":
 *
 *  1. `Number(x)` silently accepts things that are not a plain rupee amount
 *     -- `Number("1e5")` is 100000 (scientific notation treated as valid),
 *     `Number("1,234.56")` is NaN (a thousands-separator a user might very
 *     plausibly type produces NaN, not a validation error) -- so malformed
 *     input either silently succeeds as the wrong amount or silently became
 *     NaN/amountMinor: NaN, which the backend's `z.number().int()` would
 *     reject but with a raw, unhelpful validation error rather than a clear
 *     client-side message pointing at the amount field.
 *  2. `Math.round`'s compensation is incidental, not guaranteed -- it has no
 *     principled safe-integer boundary, so a sufficiently large (if
 *     unrealistic) amount can silently overflow precision with no error.
 *  3. Any future change that sums multiple amounts before this conversion
 *     (e.g. a multi-line claim) would reintroduce real, observable float
 *     drift from chained arithmetic -- an integer-only parser is immune to
 *     that entire risk class by construction, not just for today's
 *     single-amount form.
 *
 * Returns null for anything that is not a plain non-negative rupee amount
 * with at most 2 decimal places (also rejects empty input, whitespace-only
 * input, a leading '+'/'-', scientific notation, and thousands separators),
 * so the caller can surface a clean validation message instead of silently
 * coercing garbage input to 0 or NaN.
 */
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const dot = trimmed.indexOf(".");
  const rupeesPart = dot === -1 ? trimmed : trimmed.slice(0, dot);
  const paiseFraction = dot === -1 ? "" : trimmed.slice(dot + 1);
  const paiseDigits = (paiseFraction + "00").slice(0, 2);

  const rupees = parseInt(rupeesPart, 10);
  const paise = parseInt(paiseDigits, 10);
  if (!Number.isSafeInteger(rupees)) return null;

  const total = rupees * 100 + paise;
  return Number.isSafeInteger(total) ? total : null;
}

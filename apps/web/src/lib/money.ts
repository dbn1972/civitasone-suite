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
export function rupeesToMinorString(input: string, opts?: { allowZero?: boolean }): string | null {
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
  // `allowZero` (b3 payroll gap batch, GAP-PAYROLL-CORRECTIONS-03): a salary
  // correction's OLD value is legitimately 0 for a component the employee
  // did not have before. Every existing caller keeps the default (> 0).
  if (minor < 0n || (minor === 0n && !opts?.allowZero)) return null;
  return minor.toString();
}

/**
 * GAP-FINANCE-PFMS-02: parse a clerk-typed RUPEES amount that may carry
 * thousands separators (Indian "1,20,000.50" or western "120,000.50") into a
 * paise digit-string, with no float math. At most 2 decimals; anything
 * ambiguous (sub-paise, negative, empty, non-numeric) is rejected as null.
 *
 *   parseRupeesToPaise("15,000")       -> "1500000"
 *   parseRupeesToPaise("1,20,000.50")  -> "12000050"
 *   parseRupeesToPaise("12.345")       -> null
 *   parseRupeesToPaise("")             -> null
 */
export function parseRupeesToPaise(input: string): string | null {
  const text = input.trim().replace(/^₹\s*/, "");
  // Commas are accepted ONLY as valid thousands grouping -- Indian
  // (12,34,567.89) or western (1,234,567.89). Anything else is rejected, never
  // guessed: "12,50" is a European decimal comma and silently reading it as
  // 1,250 would overstate the amount 100x.
  const INDIAN = /^\d{1,2}(,\d{2})*,\d{3}(\.\d{1,2})?$/;
  const WESTERN = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
  const PLAIN = /^\d+(\.\d{1,2})?$/;
  if (!(PLAIN.test(text) || INDIAN.test(text) || WESTERN.test(text))) return null;
  return rupeesToMinorString(text.replace(/,/g, ""));
}

/**
 * Sum of rupee input strings in paise, or null if ANY entry is invalid (see
 * rupeesToMinorString). BigInt end to end -- no float accumulation
 * (GAP-PAYROLL-OFF-CYCLE-03: "0.1" + "0.2" must total exactly 30 paise).
 */
export function sumRupeesToMinor(inputs: readonly string[]): bigint | null {
  let total = 0n;
  for (const input of inputs) {
    const minor = rupeesToMinorString(input);
    if (minor === null) return null;
    total += BigInt(minor);
  }
  return total;
}

/**
 * Bonus-style amount: basic (paise) x rate (basis points), rounded half-up to
 * a paise -- the exact formula payroll-service's bonusCompute consumer
 * persists ((basicMinor * bps + 5000) / 10000), so the form's preview and
 * confirmation show what the server will store (GAP-PAYROLL-BONUS-02).
 */
export function applyBpsToMinor(minor: bigint, bps: number): bigint {
  return (minor * BigInt(bps) + 5000n) / 10000n;
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

/**
 * Like rupeesToMinorString, but ZERO is a valid amount -- for money inputs
 * where ₹0 is a legitimate, meaningful value (e.g. "TDS deducted so far this
 * year" on an F&F settlement, or an optional component the clerk leaves at
 * nil). Same string-based, float-free parsing and the same rejections
 * (non-numeric, negative, more than 2 decimal places); only the
 * "must be > 0" rule is dropped.
 *
 * GAP-PAYROLL-FNF-03: replaces ComputeFnfForm's float-based
 * `Math.round(Number(v) * 100)` conversion.
 *
 *   nonNegativeRupeesToMinorString("0")       -> "0"
 *   nonNegativeRupeesToMinorString("1234.56") -> "123456"
 *   nonNegativeRupeesToMinorString("0.1")     -> "10"
 *   nonNegativeRupeesToMinorString("1.005")   -> null
 *   nonNegativeRupeesToMinorString("-5")      -> null
 *   nonNegativeRupeesToMinorString("")        -> null
 */
export function nonNegativeRupeesToMinorString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, wholePart, fracPart = ""] = match;
  return BigInt(`${wholePart}${fracPart.padEnd(2, "0")}`).toString();
}

/**
 * GAP-FINANCE-JOURNAL-ENTRY-02: parse a journal-line amount typed in rupees.
 * Blank -> 0n (an empty side of a debit/credit line is legitimately nil);
 * a valid plain decimal with at most 2 fractional digits -> its paise as a
 * bigint (no float maths); anything else (3+ decimals such as "0.285",
 * negatives, exponents, "Infinity", thousands separators) -> null so the
 * caller can show a field error instead of silently rounding a posting amount.
 *
 *   parseMinorOrZero("")      -> 0n
 *   parseMinorOrZero("10.10") -> 1010n
 *   parseMinorOrZero("0.285") -> null
 *   parseMinorOrZero("1e5")   -> null
 */
export function parseMinorOrZero(input: string): bigint | null {
  if (input.trim() === "") return 0n;
  const minor = nonNegativeRupeesToMinorString(input);
  return minor === null ? null : BigInt(minor);
}

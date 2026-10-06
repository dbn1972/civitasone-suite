/**
 * GAP-BILLING-GSTN-06: GSTIN validation with the official GSTN mod-36 checksum.
 *
 * A GSTIN is 15 chars: 2-digit state code, 10-char PAN (5 letters + 4 digits +
 * 1 letter), 1-char entity number, literal "Z", and a check digit. The two
 * GSTN panels previously validated only the STRUCTURE (regex), accepting any
 * [0-9A-Z] as the final check digit — so a transposed/typo'd GSTIN with a
 * valid shape but wrong checksum sailed through to the external GSTN API.
 *
 * The checksum algorithm (published by GSTN / NIC): map each of the first 14
 * characters to a code (0-9 -> 0-9, A-Z -> 10-35). Multiply by an alternating
 * factor (1,2,1,2,…). For each product, add floor(p/36) + (p mod 36). The
 * check digit's code is (36 - (total mod 36)) mod 36, mapped back to a char.
 */

const CODE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Structure-only regex (same as the panels used): state(2d) PAN(5A 4d 1A)
// entity(1 non-zero alnum) "Z" check(1 alnum).
export const GSTIN_STRUCTURE_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTN mod-36 check character for the first 14 chars of a GSTIN. */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const code = CODE_CHARS.indexOf(first14[i]!);
    if (code < 0) return null;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = code * factor;
    total += Math.floor(product / 36) + (product % 36);
  }
  const checkCode = (36 - (total % 36)) % 36;
  return CODE_CHARS[checkCode] ?? null;
}

/**
 * True when `gstin` matches the GSTIN structure AND its 15th character is the
 * correct mod-36 checksum of the first 14. Case-insensitive on input (GSTINs
 * are upper-case); whitespace is trimmed.
 *
 *   isValidGstin("27AAPFU0939F1ZV") -> true   (valid published sample)
 *   isValidGstin("27AAPFU0939F1ZX") -> false  (wrong check digit)
 *   isValidGstin("not-a-gstin")     -> false
 */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_STRUCTURE_RE.test(g)) return false;
  const expected = gstinCheckChar(g.slice(0, 14));
  return expected !== null && expected === g[14];
}

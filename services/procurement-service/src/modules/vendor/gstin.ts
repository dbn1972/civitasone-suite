/**
 * GAP-PROCUREMENT-VENDORS-NEW-02: server-side GSTIN integrity. The web form
 * validates the same rules, but the server is the real control - an API caller
 * (or a stale client) must not be able to register a GSTIN whose check digit,
 * state code or embedded PAN is wrong.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // base-36

/** GSTN mod-36 check digit on the 15th character. */
export function isGstinChecksumValid(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (g.length !== 15) return false;
  const base = ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let i = 13; i >= 0; i--) {
    const code = ALPHABET.indexOf(g[i] as string);
    if (code < 0) return false;
    let digit = factor * code;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / base) + (digit % base);
    sum += digit;
  }
  return ALPHABET[(base - (sum % base)) % base] === g[14];
}

/** Valid GSTIN state codes: 01-38, plus 97 (Other Territory) and 99 (Centre). */
export function isValidGstinStateCode(gstin: string): boolean {
  const code = Number(gstin.slice(0, 2));
  return Number.isInteger(code) && ((code >= 1 && code <= 38) || code === 97 || code === 99);
}

/** Characters 3-12 of a GSTIN are the holder's PAN. */
export function gstinToPan(gstin: string): string {
  return gstin.trim().toUpperCase().slice(2, 12);
}

/**
 * Verhoeff checksum (dihedral group D5) - the scheme UIDAI uses for Aadhaar numbers.
 * Pure, dependency-free.
 */

const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function d(c: number, x: number): number {
  return D[c]?.[x] ?? 0;
}
function p(pos: number, x: number): number {
  return P[pos % 8]?.[x] ?? 0;
}

function digitsOf(s: string): number[] | null {
  if (!/^\d+$/.test(s)) return null;
  return Array.from(s, (ch) => ch.charCodeAt(0) - 48);
}

/** True iff `numberWithCheckDigit` (digits only, last digit is the check digit) passes Verhoeff. */
export function verhoeffValidate(numberWithCheckDigit: string): boolean {
  const digits = digitsOf(numberWithCheckDigit);
  if (!digits || digits.length < 2) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const dig = digits[digits.length - 1 - i] ?? 0;
    c = d(c, p(i, dig));
  }
  return c === 0;
}

/** Check digit to append to `payload` (digits only) so the result validates. */
export function verhoeffGenerate(payload: string): string {
  const digits = digitsOf(payload);
  if (!digits) throw new Error("verhoeffGenerate: payload must be digits only");
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const dig = digits[digits.length - 1 - i] ?? 0;
    c = d(c, p(i + 1, dig));
  }
  return String(INV[c] ?? 0);
}

/** Strip spaces/hyphens. Returns null when anything else remains. */
export function aadhaarDigits(input: string): string | null {
  const stripped = input.replace(/[\s-]/g, "");
  return /^\d+$/.test(stripped) ? stripped : null;
}

/** Aadhaar: 12 digits, first digit 2-9 (UIDAI never issues 0/1), Verhoeff-valid. Spaces/hyphens tolerated. */
export function isValidAadhaar(input: string): boolean {
  const digits = aadhaarDigits(input);
  if (!digits || digits.length !== 12) return false;
  if (!/^[2-9]/.test(digits)) return false;
  return verhoeffValidate(digits);
}

/** Build a syntactically valid Aadhaar from an 11-digit payload (first digit 2-9). Test/fixture helper. */
export function generateAadhaar(payload11: string): string {
  if (!/^[2-9]\d{10}$/.test(payload11)) throw new Error("payload must be 11 digits starting 2-9");
  return payload11 + verhoeffGenerate(payload11);
}

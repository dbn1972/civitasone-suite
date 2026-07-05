/**
 * NACH/APBS domain logic — pure functions for settlement date computation,
 * beneficiary validation, batch splitting, hash computation, and ASCII
 * sanitization for fixed-width file formatting.
 */

export interface NachBeneficiary {
  ifsc: string;
  accountNo: string;
  amountMinor: bigint;
  name: string;
  reference: string;
  narration: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ reference: string; field: string; message: string }>;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Parse a DDMMYYYY string into a Date (midnight UTC).
 */
function parseDDMMYYYY(s: string): Date {
  const dd = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10) - 1; // 0-indexed month
  const yyyy = parseInt(s.slice(4, 8), 10);
  return new Date(yyyy, mm, dd);
}

/**
 * Format a Date as DDMMYYYY string.
 */
function formatDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

/**
 * Check if a date is a weekend (Saturday=6, Sunday=0).
 */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date falls on a holiday (holidays in DDMMYYYY format).
 */
function isHoliday(d: Date, holidaySet: Set<string>): boolean {
  return holidaySet.has(formatDDMMYYYY(d));
}

/**
 * Check if a date is a non-business day (weekend or holiday).
 */
function isNonBusinessDay(d: Date, holidaySet: Set<string>): boolean {
  return isWeekend(d) || isHoliday(d, holidaySet);
}

/**
 * Compute the settlement date by advancing `offsetDays` business days
 * forward from `baseDate`, skipping Saturdays, Sundays, and holidays.
 *
 * If offsetDays is 0, the result is the next business day from baseDate
 * (which may be baseDate itself if it's already a business day).
 *
 * @param offsetDays - Number of business days to advance
 * @param holidays - Array of holiday dates in DDMMYYYY format
 * @param baseDate - Optional base date for testability (defaults to today)
 */
export function computeSettlementDate(
  offsetDays: number,
  holidays: string[],
  baseDate?: Date,
): string {
  const holidaySet = new Set(holidays);
  const current = baseDate ? new Date(baseDate.getTime()) : new Date();
  // Reset time to midnight for date-only logic
  current.setHours(0, 0, 0, 0);

  if (offsetDays === 0) {
    // Ensure result is a business day
    while (isNonBusinessDay(current, holidaySet)) {
      current.setDate(current.getDate() + 1);
    }
    return formatDDMMYYYY(current);
  }

  let remaining = offsetDays;
  while (remaining > 0) {
    current.setDate(current.getDate() + 1);
    if (!isNonBusinessDay(current, holidaySet)) {
      remaining--;
    }
  }
  return formatDDMMYYYY(current);
}

/**
 * Validate NACH beneficiaries for required fields:
 * - IFSC must match ^[A-Z]{4}0[A-Z0-9]{6}$
 * - accountNo must be non-empty
 * - amountMinor must be > 0n
 */
export function validateNachBeneficiaries(
  beneficiaries: NachBeneficiary[],
): ValidationResult {
  const errors: Array<{ reference: string; field: string; message: string }> = [];

  for (const b of beneficiaries) {
    if (!IFSC_RE.test(b.ifsc)) {
      errors.push({
        reference: b.reference,
        field: "ifsc",
        message: `invalid IFSC format: ${b.ifsc}`,
      });
    }
    if (!b.accountNo || b.accountNo.trim().length === 0) {
      errors.push({
        reference: b.reference,
        field: "accountNo",
        message: "account number is required",
      });
    }
    if (b.amountMinor <= 0n) {
      errors.push({
        reference: b.reference,
        field: "amountMinor",
        message: "amount must be greater than zero",
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Split beneficiaries into batches respecting both:
 * - maxRecords: maximum number of records per batch
 * - maxAmountMinor: maximum cumulative amount (in paise) per batch
 *
 * When adding the next beneficiary would exceed either limit, a new batch is started.
 * Every beneficiary ends up in exactly one batch (no loss, no duplication).
 */
export function splitIntoBatches(
  beneficiaries: NachBeneficiary[],
  maxRecords: number,
  maxAmountMinor: bigint,
): NachBeneficiary[][] {
  if (beneficiaries.length === 0) return [];

  const batches: NachBeneficiary[][] = [];
  let currentBatch: NachBeneficiary[] = [];
  let currentAmount = 0n;

  for (const b of beneficiaries) {
    const wouldExceedRecords = currentBatch.length >= maxRecords;
    const wouldExceedAmount = currentAmount + b.amountMinor > maxAmountMinor;

    if (currentBatch.length > 0 && (wouldExceedRecords || wouldExceedAmount)) {
      batches.push(currentBatch);
      currentBatch = [];
      currentAmount = 0n;
    }

    currentBatch.push(b);
    currentAmount += b.amountMinor;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Compute batch hash per NPCI spec:
 * Sum of the first 8 digits of each destination account number.
 * If account has fewer than 8 chars, left-pad with zeros to 8.
 * Return the sum mod 10^13 (13-digit max).
 */
export function computeBatchHash(beneficiaries: NachBeneficiary[]): bigint {
  let sum = 0n;

  for (const b of beneficiaries) {
    const padded = b.accountNo.padStart(8, "0");
    const first8 = padded.slice(0, 8);
    sum += BigInt(first8);
  }

  return sum % 10_000_000_000_000n; // mod 10^13
}

/**
 * Sanitize input for fixed-width ASCII fields:
 * 1. Strip any character with code > 127 (non-ASCII)
 * 2. Truncate to maxLen
 * 3. Right-pad with spaces to exactly maxLen
 */
export function sanitizeAscii(input: string, maxLen: number): string {
  // Strip non-ASCII characters
  let cleaned = "";
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) <= 127) {
      cleaned += input[i];
    }
  }

  // Truncate to maxLen
  cleaned = cleaned.slice(0, maxLen);

  // Right-pad with spaces to exactly maxLen
  return cleaned.padEnd(maxLen, " ");
}

/**
 * NACH / NEFT fixed-width bank file generator.
 *
 * Implements the standard Indian payment batch file format used by PFMS and
 * major clearing houses (NPCI NACH, RBI NEFT).
 *
 * Record structure (56-char minimum per line, space-padded):
 *
 *   Header (record type "0"):
 *     Pos  1      : "0"              — record type
 *     Pos  2–17   : Originator code  — 16 chars, right-padded with spaces
 *     Pos 18–33   : Value date       — DDMMYYYY + 8 spaces (16 chars)
 *     Pos 34–41   : File creation date — DDMMYYYY (8 chars)
 *     Pos 42–49   : File sequence no — 8 digits, zero-padded
 *     Pos 50–56   : Record count     — 7 digits, zero-padded (filled in trailer)
 *
 *   Detail (record type "1"):
 *     Pos  1      : "1"              — record type
 *     Pos  2–12   : IFSC code        — 11 chars, right-padded
 *     Pos 13–30   : Account number   — 18 chars, right-padded
 *     Pos 31–47   : Amount in paise  — 17 digits, zero-padded (no decimal point)
 *     Pos 48–82   : Account name     — 35 chars, right-padded
 *     Pos 83–107  : Narration        — 25 chars, right-padded
 *     Pos 108–115 : Payment date     — DDMMYYYY (8 chars)
 *
 *   Trailer (record type "9"):
 *     Pos  1      : "9"              — record type
 *     Pos  2–8    : Total records    — 7 digits (detail count, zero-padded)
 *     Pos  9–25   : Total amount     — 17 digits in paise, zero-padded
 *     Pos 26–56   : Filler           — spaces
 */

/** A single beneficiary row for a NACH/NEFT payment file. */
export interface BankFileRow {
  /** 11-character IFSC code of the beneficiary bank branch (e.g. "SBIN0001234"). */
  ifsc: string;
  /** Beneficiary account number (max 18 chars). */
  accountNo: string;
  /** Beneficiary account holder name (max 35 chars). */
  accountName: string;
  /** Payment amount in minor units (paise). Must be > 0n. */
  amountMinor: bigint;
  /** Narration / payment description (max 25 chars). */
  narration: string;
  /** Payment value date in ISO format YYYY-MM-DD (e.g. "2024-07-01"). */
  paymentDate: string;
}

// ── fixed-width helpers ───────────────────────────────────────────────────────

/** Left-pad with zeros to `width`. Truncates if value exceeds width. */
function zeroPad(value: string | bigint | number, width: number): string {
  return String(value).padStart(width, "0").slice(-width);
}

/** Right-pad with spaces to `width`. Truncates if value exceeds width. */
function spacePad(value: string, width: number): string {
  return value.padEnd(width, " ").slice(0, width);
}

/**
 * Convert an ISO date string (YYYY-MM-DD) to the DDMMYYYY format used in
 * Indian payment files.
 */
function toDDMMYYYY(iso: string): string {
  // iso must be exactly "YYYY-MM-DD"
  const [yyyy, mm, dd] = iso.split("-");
  if (!yyyy || !mm || !dd) throw new Error(`Invalid ISO date: ${iso}`);
  return `${dd}${mm}${yyyy}`;
}

// ── record builders ───────────────────────────────────────────────────────────

/** Build the 56-character NACH header record (record type "0"). */
function buildHeaderRecord(opts: {
  originatorCode: string;
  valueDate: string;     // YYYY-MM-DD
  fileSequenceNo: number;
  totalRecords: number;  // detail record count (for NACH header preview; also in trailer)
}): string {
  // Pos  1   : record type "0"
  // Pos  2–17: originator code, 16 chars
  // Pos 18–33: value date DDMMYYYY right-padded to 16 chars
  // Pos 34–41: file creation date DDMMYYYY
  // Pos 42–49: file sequence number, 8 digits
  // Pos 50–56: total detail records, 7 digits
  const today = new Date().toISOString().slice(0, 10);
  return [
    "0",
    spacePad(opts.originatorCode, 16),
    spacePad(toDDMMYYYY(opts.valueDate), 16),
    toDDMMYYYY(today),
    zeroPad(opts.fileSequenceNo, 8),
    zeroPad(opts.totalRecords, 7),
  ].join("");
}

/** Build a 115-character NACH detail record (record type "1"). */
function buildDetailRecord(row: BankFileRow): string {
  return [
    "1",
    spacePad(row.ifsc, 11),
    spacePad(row.accountNo, 18),
    zeroPad(row.amountMinor, 17),
    spacePad(row.accountName, 35),
    spacePad(row.narration, 25),
    toDDMMYYYY(row.paymentDate),
  ].join("");
}

/** Build the NACH trailer record (record type "9"). */
function buildTrailerRecord(detailCount: number, totalAmountPaise: bigint): string {
  // Pos  1   : record type "9"
  // Pos  2–8 : total detail records, 7 digits
  // Pos  9–25: total amount in paise, 17 digits
  // Pos 26–56: spaces filler (31 chars)
  return [
    "9",
    zeroPad(detailCount, 7),
    zeroPad(totalAmountPaise, 17),
    " ".repeat(31),
  ].join("");
}

// ── public API ────────────────────────────────────────────────────────────────

/** Options for `generateNACHFile`. */
export interface NACHFileOptions {
  /**
   * Originator / agency code registered with NPCI (max 16 chars).
   * Defaults to the `SFTP_NACH_ORIGINATOR` environment variable, then "CIVITASONE".
   */
  originatorCode?: string;
  /**
   * File value date (YYYY-MM-DD). Defaults to today.
   */
  valueDate?: string;
  /**
   * File sequence number used by the clearing house for deduplication.
   * Defaults to 1.
   */
  fileSequenceNo?: number;
}

/**
 * Generate a fixed-width NACH/NEFT payment file from a list of payment rows.
 *
 * Returns a string of CRLF-delimited records:
 *   - 1 header record  (record type "0")
 *   - N detail records (record type "1", one per `payments` entry)
 *   - 1 trailer record (record type "9")
 *
 * @throws {Error} if `payments` is empty or any `amountMinor` is <= 0n.
 */
export function generateNACHFile(payments: BankFileRow[], opts: NACHFileOptions = {}): string {
  if (payments.length === 0) {
    throw new Error("generateNACHFile: payments array must not be empty");
  }
  for (const p of payments) {
    if (p.amountMinor <= 0n) {
      throw new Error(
        `generateNACHFile: amountMinor must be > 0; got ${p.amountMinor} for account ${p.accountNo}`,
      );
    }
  }

  const originatorCode =
    opts.originatorCode ?? process.env["SFTP_NACH_ORIGINATOR"] ?? "CIVITASONE";
  const valueDate = opts.valueDate ?? new Date().toISOString().slice(0, 10);
  const fileSequenceNo = opts.fileSequenceNo ?? 1;

  const totalAmountPaise = payments.reduce((sum, p) => sum + p.amountMinor, 0n);

  const header = buildHeaderRecord({
    originatorCode,
    valueDate,
    fileSequenceNo,
    totalRecords: payments.length,
  });
  const details = payments.map(buildDetailRecord);
  const trailer = buildTrailerRecord(payments.length, totalAmountPaise);

  return [header, ...details, trailer].join("\r\n");
}

// Re-export helpers for tests
export { buildHeaderRecord, buildDetailRecord, buildTrailerRecord, toDDMMYYYY };

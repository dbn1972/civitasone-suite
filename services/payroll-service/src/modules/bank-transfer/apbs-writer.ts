/**
 * APBS (Aadhaar Payment Bridge System) fixed-width file generator.
 * Same structure as NACH but with Aadhaar-based identifiers:
 * - IIN (6 digits) instead of IFSC (11)
 * - Aadhaar number (12 digits) instead of account number (15)
 * - Transaction code "20" (APBS credit) instead of "10"
 * - All records exactly 160 chars wide
 * - CRLF line endings
 * - ASCII only, amounts in paise (zero-padded 13 digits)
 */
import type { SponsorBankConfigRow } from "../sponsor-config/schema.js";
import { sanitizeAscii } from "./domain.js";
import type { NachFileOutput } from "./nach-writer.js";

export interface ApbsBeneficiary {
  aadhaarNumber: string; // 12 digits
  iin: string;           // 6-digit IIN (Issuer Identification Number)
  amountMinor: bigint;
  name: string;
  reference: string;
  narration: string;
}

export interface ApbsFileInput {
  sponsorConfig: SponsorBankConfigRow;
  settlementDate: string; // DDMMYYYY
  beneficiaries: ApbsBeneficiary[];
  batchNumber: number;
}

const RECORD_WIDTH = 160;
const CRLF = "\r\n";

/**
 * Format today's date as DDMMYYYY.
 */
function todayDDMMYYYY(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

/**
 * Format today's date as YYYYMMDD (for filename).
 */
function todayYYYYMMDD(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * Zero-pad a bigint amount to exactly 13 digits.
 */
function formatAmount(amount: bigint): string {
  return amount.toString().padStart(13, "0");
}

/**
 * Validate Aadhaar number: must be exactly 12 digits.
 */
function validateAadhaar(aadhaar: string, reference: string): void {
  if (!aadhaar || aadhaar.trim().length === 0) {
    throw new Error(`Beneficiary ${reference}: Aadhaar number is required for APBS`);
  }
  if (!/^\d{12}$/.test(aadhaar)) {
    throw new Error(`Beneficiary ${reference}: Aadhaar number must be exactly 12 digits, got "${aadhaar}"`);
  }
}

/**
 * Validate IIN: must be exactly 6 digits.
 */
function validateIin(iin: string, reference: string): void {
  if (!/^\d{6}$/.test(iin)) {
    throw new Error(`Beneficiary ${reference}: IIN must be exactly 6 digits, got "${iin}"`);
  }
}

/**
 * Compute APBS batch hash: sum of first 8 digits of each Aadhaar number (mod 10^13).
 */
function computeApbsBatchHash(beneficiaries: ApbsBeneficiary[]): bigint {
  let sum = 0n;

  for (const b of beneficiaries) {
    const first8 = b.aadhaarNumber.slice(0, 8);
    sum += BigInt(first8);
  }

  return sum % 10_000_000_000_000n; // mod 10^13
}

/**
 * Build the Header Record (Type "01") — exactly 160 chars.
 * Same as NACH header but with transaction code "20" (APBS credit).
 *
 * | Pos   | Len | Field                                             |
 * |-------|-----|---------------------------------------------------|
 * | 1-2   |  2  | Record type: "01"                                 |
 * | 3-4   |  2  | ACH transaction code: "20" (APBS credit)          |
 * | 5-14  | 10  | Destination bank (first 4 of IFSC + 6 zeros)      |
 * | 15-16 |  2  | File type: "CR"                                   |
 * | 17-24 |  8  | File creation date (DDMMYYYY)                     |
 * | 25-32 |  8  | Settlement date (DDMMYYYY)                        |
 * | 33-47 | 15  | Sponsor bank code + user number (left-justified)  |
 * | 48-65 | 18  | Utility code (left-justified)                     |
 * | 66-160| 95  | Filler (spaces)                                   |
 */
function buildHeaderRecord(input: ApbsFileInput): string {
  const { sponsorConfig, settlementDate } = input;

  const recordType = "01";
  const achTxCode = "20"; // APBS credit
  const destBank = sponsorConfig.sponsorIfsc.slice(0, 4) + "000000";
  const fileType = "CR";
  const creationDate = todayDDMMYYYY();
  const settDate = settlementDate;
  const sponsorField = (sponsorConfig.sponsorCode + (sponsorConfig.userNumber ?? "")).padEnd(15, " ");
  const utilityCode = (sponsorConfig.utilityCode ?? "").padEnd(18, " ");
  const filler = " ".repeat(95);

  const record =
    recordType +
    achTxCode +
    destBank +
    fileType +
    creationDate +
    settDate +
    sponsorField +
    utilityCode +
    filler;

  return record;
}

/**
 * Build a Detail Record (Type "02") — exactly 160 chars.
 *
 * | Pos     | Len | Field                                        |
 * |---------|-----|----------------------------------------------|
 * | 1-2     |  2  | Record type: "02"                            |
 * | 3-8     |  6  | IIN (Issuer Identification Number)           |
 * | 9-20    | 12  | Aadhaar number                               |
 * | 21-28   |  8  | Filler (spaces)                              |
 * | 29-30   |  2  | Transaction type: "20" (APBS credit)         |
 * | 31-43   | 13  | Amount in paise (zero-padded)                |
 * | 44-83   | 40  | Beneficiary name (left-justified, padded)    |
 * | 84-103  | 20  | Originator reference (left-justified, padded)|
 * | 104-143 | 40  | Narration (left-justified, padded)           |
 * | 144-160 | 17  | Filler (spaces)                              |
 */
function buildDetailRecord(beneficiary: ApbsBeneficiary): string {
  const recordType = "02";
  const iin = beneficiary.iin; // Exactly 6 digits (validated)
  const aadhaar = beneficiary.aadhaarNumber; // Exactly 12 digits (validated)
  const filler1 = " ".repeat(8);
  const txType = "20"; // APBS credit
  const amount = formatAmount(beneficiary.amountMinor);
  const name = sanitizeAscii(beneficiary.name, 40);
  const reference = sanitizeAscii(beneficiary.reference, 20);
  const narration = sanitizeAscii(beneficiary.narration, 40);
  const filler2 = " ".repeat(17);

  const record =
    recordType +
    iin +
    aadhaar +
    filler1 +
    txType +
    amount +
    name +
    reference +
    narration +
    filler2;

  return record;
}

/**
 * Build the Batch Control Record (Type "03") — exactly 160 chars.
 *
 * | Pos    | Len | Field                                      |
 * |--------|-----|--------------------------------------------|
 * | 1-2    |  2  | Record type: "03"                          |
 * | 3-10   |  8  | Record count (detail records, zero-padded) |
 * | 11-23  | 13  | Total credit amount (paise, zero-padded)   |
 * | 24-36  | 13  | Batch hash (zero-padded)                   |
 * | 37-160 |124  | Filler (spaces)                            |
 */
function buildBatchControlRecord(
  recordCount: number,
  totalAmount: bigint,
  batchHash: bigint,
): string {
  const recordType = "03";
  const count = recordCount.toString().padStart(8, "0");
  const amount = formatAmount(totalAmount);
  const hash = batchHash.toString().padStart(13, "0");
  const filler = " ".repeat(124);

  const record = recordType + count + amount + hash + filler;

  return record;
}

/**
 * Build the File Control Record (Type "04") — exactly 160 chars.
 *
 * | Pos    | Len | Field                                      |
 * |--------|-----|--------------------------------------------|
 * | 1-2    |  2  | Record type: "04"                          |
 * | 3-6    |  4  | Total batch count (zero-padded, always 1)  |
 * | 7-14   |  8  | Total detail record count (zero-padded)    |
 * | 15-27  | 13  | Grand total credit amount (paise)          |
 * | 28-160 |133  | Filler (spaces)                            |
 */
function buildFileControlRecord(
  batchCount: number,
  totalDetailRecords: number,
  grandTotal: bigint,
): string {
  const recordType = "04";
  const batches = batchCount.toString().padStart(4, "0");
  const records = totalDetailRecords.toString().padStart(8, "0");
  const amount = formatAmount(grandTotal);
  const filler = " ".repeat(133);

  const record = recordType + batches + records + amount + filler;

  return record;
}

/**
 * Generate a single APBS file (Aadhaar Payment Bridge System).
 * Same structure as NACH but with Aadhaar-based identifiers.
 * Throws if any beneficiary has missing/invalid Aadhaar or IIN.
 */
export function generateApbsFile(input: ApbsFileInput): NachFileOutput {
  const { sponsorConfig, beneficiaries, batchNumber } = input;

  // Validate all beneficiaries have valid Aadhaar and IIN
  for (const b of beneficiaries) {
    validateAadhaar(b.aadhaarNumber, b.reference);
    validateIin(b.iin, b.reference);
  }

  // Compute totals
  let totalAmountMinor = 0n;
  for (const b of beneficiaries) {
    totalAmountMinor += b.amountMinor;
  }

  const batchHash = computeApbsBatchHash(beneficiaries);

  // Build records
  const lines: string[] = [];

  // Header
  lines.push(buildHeaderRecord(input));

  // Detail records
  for (const b of beneficiaries) {
    lines.push(buildDetailRecord(b));
  }

  // Batch control
  lines.push(buildBatchControlRecord(beneficiaries.length, totalAmountMinor, batchHash));

  // File control (single batch)
  lines.push(buildFileControlRecord(1, beneficiaries.length, totalAmountMinor));

  // Join with CRLF
  const content = lines.join(CRLF) + CRLF;

  // Filename: APBS_{sponsorCode}_{batchNumber}_{YYYYMMDD}.txt
  const filename = `APBS_${sponsorConfig.sponsorCode}_${batchNumber}_${todayYYYYMMDD()}.txt`;

  return {
    content,
    filename,
    recordCount: beneficiaries.length,
    totalAmountMinor,
    batchHash,
  };
}

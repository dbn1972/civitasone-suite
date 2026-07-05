/**
 * NACH ACH-CR fixed-width file generator.
 * Produces files compliant with NPCI NACH Credit format:
 * - All records exactly 160 chars wide
 * - CRLF line endings
 * - ASCII only, amounts in paise (zero-padded 13 digits)
 */
import type { NachBeneficiary } from "./domain.js";
import type { SponsorBankConfigRow } from "../sponsor-config/schema.js";
import { computeBatchHash, sanitizeAscii } from "./domain.js";

export interface NachFileInput {
  sponsorConfig: SponsorBankConfigRow;
  settlementDate: string; // DDMMYYYY
  beneficiaries: NachBeneficiary[];
  batchNumber: number;
}

export interface NachFileOutput {
  content: string;       // ASCII fixed-width text
  filename: string;
  recordCount: number;
  totalAmountMinor: bigint;
  batchHash: bigint;
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
 * Build the Header Record (Type "01") — exactly 160 chars.
 *
 * | Pos   | Len | Field                                             |
 * |-------|-----|---------------------------------------------------|
 * | 1-2   |  2  | Record type: "01"                                 |
 * | 3-4   |  2  | ACH transaction code: "10" (credit)               |
 * | 5-14  | 10  | Destination bank (first 4 of IFSC + 6 zeros)      |
 * | 15-16 |  2  | File type: "CR"                                   |
 * | 17-24 |  8  | File creation date (DDMMYYYY)                     |
 * | 25-32 |  8  | Settlement date (DDMMYYYY)                        |
 * | 33-47 | 15  | Sponsor bank code + user number (left-justified)  |
 * | 48-65 | 18  | Utility code (left-justified)                     |
 * | 66-160| 95  | Filler (spaces)                                   |
 */
function buildHeaderRecord(input: NachFileInput): string {
  const { sponsorConfig, settlementDate } = input;

  const recordType = "01";
  const achTxCode = "10";
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
 * | 3-13    | 11  | Destination IFSC                             |
 * | 14-28   | 15  | Destination account (left-justified, padded) |
 * | 29-30   |  2  | Transaction type: "10" (credit)              |
 * | 31-43   | 13  | Amount in paise (zero-padded)                |
 * | 44-83   | 40  | Beneficiary name (left-justified, padded)    |
 * | 84-103  | 20  | Originator reference (left-justified, padded)|
 * | 104-143 | 40  | Narration (left-justified, padded)           |
 * | 144-160 | 17  | Filler (spaces)                              |
 */
function buildDetailRecord(beneficiary: NachBeneficiary): string {
  const recordType = "02";
  const ifsc = beneficiary.ifsc.padEnd(11, " ");
  const account = beneficiary.accountNo.padEnd(15, " ");
  const txType = "10";
  const amount = formatAmount(beneficiary.amountMinor);
  const name = sanitizeAscii(beneficiary.name, 40);
  const reference = sanitizeAscii(beneficiary.reference, 20);
  const narration = sanitizeAscii(beneficiary.narration, 40);
  const filler = " ".repeat(17);

  const record =
    recordType +
    ifsc +
    account +
    txType +
    amount +
    name +
    reference +
    narration +
    filler;

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
 * Generate a single NACH ACH-CR file (≤ maxRecordsPerFile beneficiaries).
 * Returns the fixed-width content with CRLF line endings and metadata.
 */
export function generateNachFile(input: NachFileInput): NachFileOutput {
  const { sponsorConfig, beneficiaries, batchNumber } = input;

  // Compute totals
  let totalAmountMinor = 0n;
  for (const b of beneficiaries) {
    totalAmountMinor += b.amountMinor;
  }

  const batchHash = computeBatchHash(beneficiaries);

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

  // Filename: NACH_{sponsorCode}_{batchNumber}_{YYYYMMDD}.txt
  const filename = `NACH_${sponsorConfig.sponsorCode}_${batchNumber}_${todayYYYYMMDD()}.txt`;

  return {
    content,
    filename,
    recordCount: beneficiaries.length,
    totalAmountMinor,
    batchHash,
  };
}

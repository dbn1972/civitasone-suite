/**
 * NACH Return File Parser — parses fixed-width (160 char/line, CRLF) NACH
 * return/response files from the bank after settlement. Extracts per-record
 * status (credited / returned) and NPCI rejection reason codes.
 */

export interface NachReturnRecord {
  reference: string;    // Originator reference (employee no)
  amountMinor: bigint;  // Amount in paise
  statusCode: string;   // "0" = credited, "1" = returned
  reasonCode: string;   // 4-char NPCI rejection reason code
  reasonText: string;   // Human-readable reason
}

/** NPCI standard rejection reason codes → human-readable text. */
const REASON_CODES: Record<string, string> = {
  "01": "Account closed",
  "02": "NPA account",
  "03": "Name mismatch",
  "04": "IFSC invalid",
  "05": "Account does not exist",
  "06": "Account frozen",
  "07": "Account under litigation",
  "08": "No such account",
  "09": "Incorrect account type",
  "10": "Mandate not registered",
  "11": "Invalid mandate",
  "12": "Mandate expired",
  "13": "Insufficient funds",
  "14": "Technical error at destination bank",
  "15": "Beneficiary bank not reachable",
};

/**
 * Parse a NACH return file (fixed-width, 160 chars per line, CRLF separated).
 *
 * File structure:
 * - Line 1: Header record (type "01")
 * - Lines 2..N-2: Detail records (type "02") — one per beneficiary
 * - Line N-1: Batch control (type "03")
 * - Line N: File control (type "04")
 *
 * Detail record layout (relevant positions for return parsing):
 * | Pos     | Len | Field                                |
 * |---------|-----|--------------------------------------|
 * | 31-43   | 13  | Amount in paise (zero-padded)        |
 * | 84-103  | 20  | Originator reference (employee no)   |
 * | 144-145 |  2  | Status code ("0" credited, "1" ret)  |
 * | 146-149 |  4  | Reason code (NPCI rejection reason)  |
 *
 * @throws Error if the file structure is invalid
 */
export function parseNachReturnFile(content: string): NachReturnRecord[] {
  // Normalize line endings: handle CRLF, CR, or LF
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    .filter((line) => line.length > 0);

  if (lines.length < 3) {
    throw new Error("INVALID_RETURN_FILE: file must contain at least header, one detail, and control records");
  }

  // Validate header record
  const header = lines[0]!;
  if (header.length < 2 || header.slice(0, 2) !== "01") {
    throw new Error("INVALID_RETURN_FILE: first record must be type '01' (header)");
  }

  // Validate that we have at least one control record at the end
  const lastLine = lines[lines.length - 1]!;
  const secondLastLine = lines.length > 2 ? lines[lines.length - 2]! : null;

  const lastType = lastLine.slice(0, 2);
  if (lastType !== "03" && lastType !== "04") {
    throw new Error("INVALID_RETURN_FILE: last record must be type '03' (batch control) or '04' (file control)");
  }

  // Determine where detail records end (they have type "02")
  const records: NachReturnRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const recordType = line.slice(0, 2);

    // Skip control records
    if (recordType === "03" || recordType === "04") continue;

    // Validate detail record type
    if (recordType !== "02") {
      throw new Error(`INVALID_RETURN_FILE: unexpected record type '${recordType}' at line ${i + 1}`);
    }

    // Validate line length (must be at least 149 chars for required fields)
    if (line.length < 149) {
      throw new Error(`INVALID_RETURN_FILE: detail record at line ${i + 1} is too short (${line.length} chars, expected 160)`);
    }

    // Extract fields (0-indexed positions, design spec is 1-indexed)
    // Amount: pos 31-43 (0-indexed: 30..42, 13 chars)
    const amountStr = line.slice(30, 43).trim();
    const amountMinor = BigInt(amountStr || "0");

    // Reference: pos 84-103 (0-indexed: 83..102, 20 chars)
    const reference = line.slice(83, 103).trim();

    // Status code: pos 144-145 (0-indexed: 143..144, 2 chars)
    const statusCode = line.slice(143, 145).trim();

    // Reason code: pos 146-149 (0-indexed: 145..148, 4 chars)
    const reasonCode = line.slice(145, 149).trim();

    // Resolve human-readable reason
    const reasonText = statusCode === "1"
      ? (REASON_CODES[reasonCode] ?? `Unknown reason (${reasonCode})`)
      : "";

    records.push({
      reference,
      amountMinor,
      statusCode: statusCode || "0",
      reasonCode: reasonCode || "",
      reasonText,
    });
  }

  if (records.length === 0) {
    throw new Error("INVALID_RETURN_FILE: no detail records found");
  }

  return records;
}

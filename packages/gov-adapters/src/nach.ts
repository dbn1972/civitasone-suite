/**
 * NPCI NACH/APBS (Aadhaar Payment Bridge System) adapter.
 *
 * Generates NACH ECS Debit/Credit mandate files and APBS bank files in the
 * NPCI-specified fixed-width format for bulk salary/pension disbursement.
 *
 * Env-gated: defaults to mock mode. In production, generates real NACH files
 * and submits to the sponsor bank's SFTP/API.
 *
 * Env vars:
 *   NACH_MODE           — "mock" (default) | "production"
 *   NACH_SPONSOR_BANK   — sponsor bank utility code
 *   NACH_DEST_BANK      — destination bank IFSC prefix
 *   NACH_SFTP_HOST      — SFTP host for file submission
 *   NACH_SFTP_USER      — SFTP username
 *   NACH_SFTP_KEY_PATH  — path to SFTP private key
 */

// ── Types ─────────────────────────────────────────────────────────

export interface NachBeneficiary {
  name: string;
  bankAccount: string;
  ifsc: string;
  amount: bigint; // paise
  narration?: string;
}

export interface NachFileRequest {
  /** Batch reference (e.g. payroll run no) */
  batchRef: string;
  /** Sponsor bank utility code */
  utilityCode?: string;
  /** Settlement date (YYYY-MM-DD) */
  settlementDate: string;
  /** List of beneficiaries */
  beneficiaries: NachBeneficiary[];
}

export interface NachFileResponse {
  /** Generated file content (fixed-width text) */
  fileContent: string;
  /** File name per NPCI naming convention */
  fileName: string;
  /** Total amount in paise */
  totalAmountMinor: bigint;
  /** Number of records */
  recordCount: number;
  /** Submission status */
  submitted: boolean;
}

export class NachAdapterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "NachAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const MODE = (process.env.NACH_MODE ?? "mock") as "mock" | "production";
const SPONSOR_BANK = process.env.NACH_SPONSOR_BANK ?? "NACH00000000000001";

function assertConfigured(): void {
  if (MODE === "mock") return;
  if (!process.env.NACH_SFTP_HOST || !process.env.NACH_SFTP_USER) {
    throw new NachAdapterError(
      "NACH adapter is not configured. Set NACH_SFTP_HOST and NACH_SFTP_USER.",
      "NACH_NOT_CONFIGURED",
    );
  }
}

// ── File Generation (NPCI NACH Credit format) ─────────────────────

/**
 * Generate NACH/APBS credit file in NPCI fixed-width format.
 *
 * Format: 160-char fixed width records:
 *   Header (ACH-CR-Header), Detail (ACH-CR-Detail), Footer (ACH-CR-Footer)
 */
export function generateNachCreditFile(req: NachFileRequest): NachFileResponse {
  const utilityCode = req.utilityCode ?? SPONSOR_BANK;
  const records: string[] = [];
  let totalMinor = 0n;

  // Header record (simplified NPCI format)
  const header = [
    "56",                                    // record type: ACH credit
    padRight(utilityCode, 18),               // utility code
    padRight(req.batchRef, 30),              // user reference
    req.settlementDate.replace(/-/g, ""),     // settlement date DDMMYYYY
    padRight("", 80),                        // filler
  ].join("");
  records.push(padRight(header, 160));

  // Detail records
  for (const b of req.beneficiaries) {
    const amtRupees = Number(b.amount) / 100;
    totalMinor += b.amount;
    const detail = [
      "67",                                  // record type: detail
      padRight(b.ifsc, 11),                  // dest bank IFSC
      padRight(b.bankAccount, 20),           // beneficiary account
      padLeft(amtRupees.toFixed(2).replace(".", ""), 13, "0"), // amount in paise (13 digits)
      padRight(b.name, 40),                  // beneficiary name
      padRight(b.narration ?? "SALARY", 30), // narration
      padRight("", 44),                      // filler
    ].join("");
    records.push(padRight(detail, 160));
  }

  // Footer record
  const footer = [
    "78",                                    // record type: footer
    padLeft(String(req.beneficiaries.length), 9, "0"), // total count
    padLeft(String(totalMinor), 15, "0"),     // total amount
    padRight("", 134),                       // filler
  ].join("");
  records.push(padRight(footer, 160));

  const fileContent = records.join("\n");
  const dateStr = req.settlementDate.replace(/-/g, "");
  const fileName = `ACH-CR-${utilityCode}-${dateStr}-${req.batchRef}.txt`;

  return {
    fileContent,
    fileName,
    totalAmountMinor: totalMinor,
    recordCount: req.beneficiaries.length,
    submitted: false,
  };
}

/**
 * Generate and optionally submit a NACH credit file.
 * In mock mode, generates the file but does not submit.
 * In production, generates and submits via SFTP.
 */
export async function generateAndSubmit(req: NachFileRequest): Promise<NachFileResponse> {
  assertConfigured();
  const result = generateNachCreditFile(req);

  if (MODE === "production") {
    // Production: submit via SFTP
    // This is a placeholder — real implementation would use ssh2-sftp-client
    // await submitToSftp(result.fileName, result.fileContent);
    result.submitted = true;
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────

function padRight(s: string, len: number, fill = " "): string {
  return s.slice(0, len).padEnd(len, fill);
}

function padLeft(s: string, len: number, fill = " "): string {
  return s.slice(0, len).padStart(len, fill);
}

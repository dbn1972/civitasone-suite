/**
 * Format router — dispatches bank file generation to the appropriate writer
 * (NACH or APBS) and handles batch splitting when the beneficiary list exceeds
 * per-file limits. Returns null for "csv" format (existing CSV logic stays in routes.ts).
 */
import type { SponsorBankConfigRow } from "../sponsor-config/schema.js";
import type { NachBeneficiary } from "./domain.js";
import { splitIntoBatches } from "./domain.js";
import { generateNachFile } from "./nach-writer.js";
import { generateApbsFile, type ApbsBeneficiary } from "./apbs-writer.js";

export type BankFileFormat = "csv" | "nach" | "apbs";

export type BankFileResult =
  | { type: "single"; content: string; filename: string; contentType: string }
  | { type: "multi"; parts: Array<{ content: string; filename: string }>; archiveName: string };

/**
 * Generate a bank file in the requested format. Returns null for "csv" (handled
 * by existing route logic). For NACH/APBS, handles batch splitting and returns
 * either a single file or multiple parts for ZIP archiving.
 */
export function generateBankFile(
  format: BankFileFormat,
  sponsorConfig: SponsorBankConfigRow,
  settlementDate: string,
  beneficiaries: NachBeneficiary[] | ApbsBeneficiary[],
  batchNumber: number,
): BankFileResult | null {
  if (format === "csv") return null;

  const maxRecords = sponsorConfig.maxRecordsPerFile;
  const maxAmount = sponsorConfig.maxAmountPerFileMinor;

  if (format === "nach") {
    const nachBeneficiaries = beneficiaries as NachBeneficiary[];
    const batches = splitIntoBatches(nachBeneficiaries, maxRecords, maxAmount);

    if (batches.length === 1) {
      const output = generateNachFile({
        sponsorConfig,
        settlementDate,
        beneficiaries: batches[0]!,
        batchNumber,
      });
      return {
        type: "single",
        content: output.content,
        filename: output.filename,
        contentType: "text/plain; charset=ascii",
      };
    }

    // Multiple batches — return parts for ZIP assembly
    const parts: Array<{ content: string; filename: string }> = [];
    for (let i = 0; i < batches.length; i++) {
      const output = generateNachFile({
        sponsorConfig,
        settlementDate,
        beneficiaries: batches[i]!,
        batchNumber: batchNumber + i,
      });
      parts.push({ content: output.content, filename: output.filename });
    }

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const archiveName = `NACH_${sponsorConfig.sponsorCode}_${yyyy}${mm}${dd}.zip`;

    return { type: "multi", parts, archiveName };
  }

  // APBS format
  const apbsBeneficiaries = beneficiaries as ApbsBeneficiary[];

  // APBS uses the same batch splitting logic based on record count and amount
  // We need to split manually since splitIntoBatches expects NachBeneficiary
  const apbsBatches: ApbsBeneficiary[][] = [];
  let currentBatch: ApbsBeneficiary[] = [];
  let currentAmount = 0n;

  for (const b of apbsBeneficiaries) {
    const wouldExceedRecords = currentBatch.length >= maxRecords;
    const wouldExceedAmount = currentAmount + b.amountMinor > maxAmount;

    if (currentBatch.length > 0 && (wouldExceedRecords || wouldExceedAmount)) {
      apbsBatches.push(currentBatch);
      currentBatch = [];
      currentAmount = 0n;
    }

    currentBatch.push(b);
    currentAmount += b.amountMinor;
  }
  if (currentBatch.length > 0) apbsBatches.push(currentBatch);

  if (apbsBatches.length === 1) {
    const output = generateApbsFile({
      sponsorConfig,
      settlementDate,
      beneficiaries: apbsBatches[0]!,
      batchNumber,
    });
    return {
      type: "single",
      content: output.content,
      filename: output.filename,
      contentType: "text/plain; charset=ascii",
    };
  }

  const parts: Array<{ content: string; filename: string }> = [];
  for (let i = 0; i < apbsBatches.length; i++) {
    const output = generateApbsFile({
      sponsorConfig,
      settlementDate,
      beneficiaries: apbsBatches[i]!,
      batchNumber: batchNumber + i,
    });
    parts.push({ content: output.content, filename: output.filename });
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const archiveName = `APBS_${sponsorConfig.sponsorCode}_${yyyy}${mm}${dd}.zip`;

  return { type: "multi", parts, archiveName };
}

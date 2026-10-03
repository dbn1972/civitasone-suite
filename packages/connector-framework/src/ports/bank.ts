import type { IntegrationAdapter } from "./types.js";

export type PaymentFileFormat = "csv" | "iso20022" | "fixed_width";

export interface SubmitPaymentFileRequest {
  fileName: string;
  fileFormat: PaymentFileFormat;
  /** Hex SHA-256 of the exact bytes being submitted. */
  fileHashSha256: string;
  recordCount: number;
  /** Batch total in paise (minor units). */
  totalAmountMinor: bigint;
  /** Detached signature over the file, when the bank profile requires one. Produced elsewhere. */
  signatureBase64?: string | undefined;
}

export interface SubmitPaymentFileResult {
  submissionId: string;
  accepted: boolean;
  receivedAt: string;
  rejectionReason?: string | undefined;
}

export type PaymentFileStatus = "received" | "processing" | "processed" | "partially_processed" | "rejected";

export interface FetchStatusRequest {
  submissionId: string;
}

export interface FetchStatusResult {
  submissionId: string;
  status: PaymentFileStatus;
  processedCount: number;
  failedCount: number;
  reason?: string | undefined;
}

/** Corporate banking API / host-to-host port. */
export interface BankApi extends IntegrationAdapter {
  submitPaymentFile(req: SubmitPaymentFileRequest): Promise<SubmitPaymentFileResult>;
  fetchStatus(req: FetchStatusRequest): Promise<FetchStatusResult>;
}

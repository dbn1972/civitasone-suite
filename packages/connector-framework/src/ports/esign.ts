import type { IntegrationAdapter } from "./types.js";

export interface EsignInitiateRequest {
  /** Caller-side document id (opaque to the provider). */
  documentId: string;
  /** Hex SHA-256 of the document to be signed. The document itself never leaves the caller. */
  documentHashSha256: string;
  signerName: string;
  /** Opaque reference to the signer (employee id etc.); never an Aadhaar number. */
  signerRef: string;
  reason: string;
  callbackUrl?: string | undefined;
}

export interface EsignInitiateResult {
  transactionId: string;
  /** Where the signer is sent to authenticate (OTP/biometric). */
  redirectUrl: string;
  expiresAt: string;
}

export interface EsignVerifyRequest {
  transactionId: string;
}

export type EsignStatus = "pending" | "signed" | "failed" | "expired";

export interface EsignVerifyResult {
  transactionId: string;
  status: EsignStatus;
  signedAt?: string | undefined;
  certificateSerial?: string | undefined;
  failureReason?: string | undefined;
}

/** Aadhaar eSign ESP port. */
export interface EsignProvider extends IntegrationAdapter {
  initiate(req: EsignInitiateRequest): Promise<EsignInitiateResult>;
  verify(req: EsignVerifyRequest): Promise<EsignVerifyResult>;
}

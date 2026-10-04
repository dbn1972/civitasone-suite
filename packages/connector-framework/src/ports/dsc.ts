import type { IntegrationAdapter } from "./types.js";

export interface DscSignRequest {
  /** Hex SHA-256 of the payload to sign. */
  payloadHashSha256: string;
  /** Reference to the signing identity (token slot / HSM key label). Never key material. */
  signerRef: string;
  reason: string;
}

export interface DscSignResult {
  signatureBase64: string;
  algorithm: string;
  certificateSerial: string;
  signedAt: string;
}

/** Digital Signature Certificate signer port (USB-token/local bridge or remote HSM). */
export interface DscSigner extends IntegrationAdapter {
  sign(req: DscSignRequest): Promise<DscSignResult>;
}

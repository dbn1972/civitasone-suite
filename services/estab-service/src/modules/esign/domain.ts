import { createHash } from "node:crypto";

export class DomainError extends Error {
  constructor(public code: string, message: string) { super(`[${code}] ${message}`); this.name = "DomainError"; }
}

export const SIGN_METHODS = ["aadhaar_esign", "dsc"] as const;
export type SignMethod = (typeof SIGN_METHODS)[number];

export const SIGN_MODES = ["disabled", "optional", "mandatory"] as const;
export type SignMode = (typeof SIGN_MODES)[number];

export const SIGN_SUBJECTS = ["noting", "dfa"] as const;
export type SignSubject = (typeof SIGN_SUBJECTS)[number];

export interface SignConfig {
  mode: SignMode;
  allowedMethods: SignMethod[];
}

export interface SignerContext {
  signerId: string;
  name?: string | undefined;
  designation?: string | undefined;
}

/** Result of a provider signing (or of verifying a client-supplied CMS). */
export interface SignatureResult {
  pkcs7: string;
  certSerial: string;
  certSubject: string;
  certIssuer: string;
  signedAt: Date;
  txnRef: string;
}

export interface VerifyResult {
  valid: boolean;
  revoked: boolean;
  subject: string;
  issuer: string;
}

/**
 * A pluggable Indian e-signature provider.
 *  - Aadhaar eSign (ASP↔ESP): `sign` is a server-side gateway call (web/mobile);
 *    the ESP mints a short-lived DSC and returns the CMS.
 *  - DSC token: the desktop signer utility produces the CMS on the officer's
 *    machine; the client POSTs it and the server `verify`s the chain/revocation.
 */
export interface ESignProvider {
  readonly name: string;
  readonly method: SignMethod;
  sign(input: { docHash: string; signer: SignerContext }): Promise<SignatureResult>;
  verify(input: { docHash: string; pkcs7: string; certSubject?: string; certIssuer?: string; certSerial?: string }): Promise<VerifyResult>;
}

/** Canonical SHA-256 document hash for a signable artefact. */
export function computeDocHash(subjectType: SignSubject, subjectId: string, body: string): string {
  return createHash("sha256").update(`${subjectType}:${subjectId}:${body}`).digest("hex");
}

/**
 * Enforce the tenant signing policy at the point of signing: signing must be
 * enabled (mode != disabled) and the requested method must be permitted.
 */
export function assertSigningAllowed(config: SignConfig, method: SignMethod): void {
  if (config.mode === "disabled") {
    throw new DomainError("SIGNING_DISABLED", "e-signature is not enabled for this tenant");
  }
  if (!config.allowedMethods.includes(method)) {
    throw new DomainError("METHOD_NOT_ALLOWED", `signing method '${method}' is not permitted; allowed: ${config.allowedMethods.join(", ")}`);
  }
}

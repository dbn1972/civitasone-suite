/**
 * Signing status of a PFMS treasury batch (GAP-FINANCE-PFMS-01), derived from the `signing` block the batches
 * endpoint returns. Pure, so the status rules are unit-tested and the page components stay free of branching.
 */
export type PfmsSigning = {
  status: "unsigned" | "signed" | "signed_legacy";
  signedAt: string | null;
  signedByName: string | null;
  certificateSerial: string | null;
  algorithm: string | null;
  signerRef: string | null;
  providerKey: string | null;
  environment: "sandbox" | "production" | null;
  /** true = produced by the sandbox MOCK signer (not a legal signature); null when unsigned. */
  mock: boolean | null;
  batchDigest: string | null;
  verifiedAt: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Anything that is not an exact known shape degrades to "unsigned" rather than being cast through. */
export function parseSigning(raw: unknown): PfmsSigning {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = r.status === "signed" || r.status === "signed_legacy" ? r.status : "unsigned";
  const env = r.environment === "sandbox" || r.environment === "production" ? r.environment : null;
  return {
    status,
    signedAt: str(r.signedAt),
    signedByName: str(r.signedByName),
    certificateSerial: str(r.certificateSerial),
    algorithm: str(r.algorithm),
    signerRef: str(r.signerRef),
    providerKey: str(r.providerKey),
    environment: env,
    mock: typeof r.mock === "boolean" ? r.mock : null,
    batchDigest: str(r.batchDigest),
    verifiedAt: str(r.verifiedAt),
  };
}

/** Sign is offered only while the batch is still pending and unsigned. */
export function canSign(submissionStatus: string, signing: PfmsSigning): boolean {
  return submissionStatus === "pending" && signing.status === "unsigned";
}

/** Release is offered on a signed batch that has not been sent yet (including one blocked as unsigned in production before it was signed). */
export function canRelease(submissionStatus: string, signing: PfmsSigning): boolean {
  return submissionStatus === "signed" && signing.status === "signed";
}

/** Refusal codes finance-service answers on release, mapped to message keys (pfmsReleaseBatchAction.*). Unknown -> null (generic message). */
const REFUSALS: Record<string, string> = {
  UNSIGNED_BATCH: "refusedUnsigned",
  NOT_SIGNED: "refusedUnsigned",
  MOCK_SIGNATURE: "refusedMock",
  MAKER_CHECKER_VIOLATION: "refusedMakerChecker",
  BATCH_CHANGED_AFTER_SIGNING: "refusedChanged",
  SIGNEDINFO_MISMATCH: "refusedChanged",
  UNSUPPORTED_CANONICAL_VERSION: "refusedChanged",
  SIGNATURE_INVALID: "refusedInvalid",
  SIGNATURE_UNVERIFIABLE: "refusedUnverifiable",
  INVALID_CHANNEL: "refusedChannel",
  NOT_FOUND: "refusedNotFound",
};
export function releaseRefusalKey(code: string | null): string | null {
  return code && Object.prototype.hasOwnProperty.call(REFUSALS, code) ? REFUSALS[code]! : null;
}

/**
 * DSC signing of PFMS treasury batches (GAP-FINANCE-PFMS-01).
 *
 * Pure functions only (no I/O) so the canonicalisation is unit-testable and provably deterministic.
 *
 * Scheme -- XML-DSig by decision, built on a port that signs HASHES only:
 *   1. canonicalizeBatch()  -> the canonical batch text (civitas-pfms-batch/v1, below).
 *   2. digest               =  SHA-256(canonical batch)              -> <Reference><DigestValue>
 *   3. buildSignedInfo()    -> a SignedInfo element we generate in exclusive-C14N form (no XML
 *                              declaration, fixed attribute order, no self-closing tags, no insignificant
 *                              whitespace), so its bytes are canonical by construction and need no XML parser.
 *   4. the DscSigner port signs SHA-256(SignedInfo bytes). That is exactly what XML-DSig defines: the
 *      SignatureValue is a signature over the canonicalised SignedInfo, which in turn commits to the
 *      batch through DigestValue.
 *   5. buildXmlDsig()       -> the <Signature> envelope assembled from the port's signature + cert serial.
 * The port returns no certificate body, so the envelope's KeyInfo carries X509IssuerSerial-style
 * serial info only (X509SerialNumber); a verifier needs the certificate from the signing provider (VERIFY).
 */
import { createHash } from "node:crypto";

export const CANONICAL_VERSION = "civitas-pfms-batch/v1";
export const DSIG_NS = "http://www.w3.org/2000/09/xmldsig#";
export const C14N_EXCLUSIVE = "http://www.w3.org/2001/10/xml-exc-c14n#";
export const DIGEST_SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
export const BATCH_TRANSFORM = "urn:civitasone:pfms:batch-canonical:v1";
export const SIG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export interface CanonicalBatchHeader {
  tenantId: string;
  pfmsId: string;
  type: string;
  currency: string;
  agencyCode: string | null;
  schemeCode: string | null;
  ddoCode: string | null;
  /** Aggregate PAISE as a bigint (never a float). */
  amountMinor: bigint;
}

export interface CanonicalBeneficiary {
  ref: string;
  beneficiary: string;
  account: string;
  ifsc: string;
  /** PAISE. */
  amountMinor: bigint;
  ddoCode: string | null;
}

/** NFC-normalise, then escape the field separator and line breaks so a value can never forge another field/line. */
function esc(v: string | null | undefined): string {
  return (v ?? "").normalize("NFC").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/** Bytewise (code-unit) comparison -- locale independent, so ordering is identical on every host. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The canonical batch text. Fixed layout, "\n" separators, no trailing newline, amounts as decimal paise
 * integers, beneficiary lines sorted bytewise on the full escaped line (so two rows can never tie
 * ambiguously and input order never matters):
 *
 *   civitas-pfms-batch/v1
 *   tenant=<uuid lower-case>
 *   pfms_id=..  batch_type=..  currency=..  agency=..  scheme=..  ddo=..  amount_minor=..  beneficiary_count=..
 *   b=<ref>|<beneficiary>|<account>|<ifsc>|<amount_minor>|<ddo>     (one per beneficiary, sorted)
 */
export function canonicalizeBatch(header: CanonicalBatchHeader, beneficiaries: readonly CanonicalBeneficiary[]): string {
  const lines = beneficiaries
    .map((b) => `b=${[esc(b.ref), esc(b.beneficiary), esc(b.account), esc(b.ifsc), b.amountMinor.toString(), esc(b.ddoCode)].join("|")}`)
    .sort(cmp);
  return [
    CANONICAL_VERSION,
    `tenant=${header.tenantId.toLowerCase()}`,
    `pfms_id=${esc(header.pfmsId)}`,
    `batch_type=${esc(header.type)}`,
    `currency=${esc(header.currency)}`,
    `agency=${esc(header.agencyCode)}`,
    `scheme=${esc(header.schemeCode)}`,
    `ddo=${esc(header.ddoCode)}`,
    `amount_minor=${header.amountMinor.toString()}`,
    `beneficiary_count=${beneficiaries.length}`,
    ...lines,
  ].join("\n");
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export function batchDigestHex(canonical: string): string {
  return sha256Hex(canonical);
}

function xmlAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}
function xmlText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

/** Reference id of the signed batch inside the envelope. */
export const batchReferenceId = (pfmsId: string): string => `pfms-batch-${pfmsId.replace(/[^A-Za-z0-9_.-]/g, "_")}`;

/** SignedInfo in exclusive-C14N form. The namespace is declared on the element so it can be hashed standalone. */
export function buildSignedInfo(p: { digestHex: string; pfmsId: string; signatureMethod?: string }): string {
  const digestB64 = Buffer.from(p.digestHex, "hex").toString("base64");
  return (
    `<SignedInfo xmlns="${DSIG_NS}">` +
    `<CanonicalizationMethod Algorithm="${C14N_EXCLUSIVE}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${xmlAttr(p.signatureMethod ?? SIG_RSA_SHA256)}"></SignatureMethod>` +
    `<Reference URI="#${xmlAttr(batchReferenceId(p.pfmsId))}">` +
    `<Transforms><Transform Algorithm="${BATCH_TRANSFORM}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${DIGEST_SHA256}"></DigestMethod>` +
    `<DigestValue>${digestB64}</DigestValue>` +
    `</Reference></SignedInfo>`
  );
}

/** The envelope is assembled FROM the port's signature: SignedInfo + SignatureValue + KeyInfo(serial). */
export function buildXmlDsig(p: { signedInfo: string; signatureBase64: string; certificateSerial: string }): string {
  return (
    `<Signature xmlns="${DSIG_NS}">` +
    p.signedInfo.replace(` xmlns="${DSIG_NS}"`, "") +
    `<SignatureValue>${xmlText(p.signatureBase64)}</SignatureValue>` +
    `<KeyInfo><X509Data><X509SerialNumber>${xmlText(p.certificateSerial)}</X509SerialNumber></X509Data></KeyInfo>` +
    `</Signature>`
  );
}

// ── verification ────────────────────────────────────────────────────────────

export interface StoredSignature {
  batchDigest: string | null;
  signedInfoHash: string | null;
  signature: string | null;
  algorithm: string | null;
  signatureMethod: string | null;
  certSerial: string | null;
  signerRef: string | null;
  canonicalVersion: string | null;
}

export type VerifyResult =
  | { ok: true; method: string; mock: boolean }
  | { ok: false; code: "NOT_SIGNED" | "BATCH_CHANGED_AFTER_SIGNING" | "SIGNEDINFO_MISMATCH" | "SIGNATURE_INVALID" | "SIGNATURE_UNVERIFIABLE" | "UNSUPPORTED_CANONICAL_VERSION"; message: string };

/**
 * Verifies ONE algorithm family. `signedInfoHash` is what was signed; return true when the signature is valid.
 * The DscSigner port has no verify and returns no certificate body, so a real (non-mock) verifier needs the
 * provider's certificate/public key: register it here once the production channel exists (UAT).
 */
export type SignatureVerifier = (s: { signature: string; signedInfoHash: string; signerRef: string | null }) => boolean;

const verifiers: Array<{ prefix: string; method: string; verify: SignatureVerifier }> = [
  {
    // The sandbox mock signs "MOCK-DSC|<signerRef>|<hash>|<reason hash>" -- not cryptography, but it commits to
    // the signed hash and the signer, so tampering with either is detected.
    prefix: "MOCK-",
    method: "mock-structural",
    verify: ({ signature, signedInfoHash, signerRef }) => {
      let decoded: string;
      try { decoded = Buffer.from(signature, "base64").toString("utf8"); } catch { return false; }
      const parts = decoded.split("|");
      return parts[0] === "MOCK-DSC" && parts[1] === (signerRef ?? "") && parts[2] === signedInfoHash;
    },
  },
];

/** Registration seam for the production verifier (UAT). Later registrations win. */
export function registerSignatureVerifier(prefix: string, method: string, verify: SignatureVerifier): void {
  verifiers.unshift({ prefix, method, verify });
}

/**
 * Re-verify a stored signature against the batch as it stands NOW. `currentDigest` is recomputed by the caller from
 * live data; any change to a beneficiary, amount or header after signing makes this fail closed.
 */
export function verifyStoredSignature(s: StoredSignature, currentDigest: string, pfmsId: string): VerifyResult {
  if (!s.signature || !s.batchDigest || !s.signedInfoHash || !s.algorithm || !s.certSerial) {
    return { ok: false, code: "NOT_SIGNED", message: "batch has no complete DSC signature on record" };
  }
  if (s.canonicalVersion !== CANONICAL_VERSION) {
    return { ok: false, code: "UNSUPPORTED_CANONICAL_VERSION", message: `signature was made over canonical version ${s.canonicalVersion ?? "unknown"}, expected ${CANONICAL_VERSION}` };
  }
  if (s.batchDigest !== currentDigest) {
    return { ok: false, code: "BATCH_CHANGED_AFTER_SIGNING", message: "the batch contents no longer match the digest that was signed" };
  }
  const rebuilt = buildSignedInfo({ digestHex: s.batchDigest, pfmsId, ...(s.signatureMethod ? { signatureMethod: s.signatureMethod } : {}) });
  if (sha256Hex(rebuilt) !== s.signedInfoHash) {
    return { ok: false, code: "SIGNEDINFO_MISMATCH", message: "stored signed-info hash does not match the batch digest" };
  }
  const v = verifiers.find((x) => s.algorithm!.startsWith(x.prefix));
  if (!v) {
    return { ok: false, code: "SIGNATURE_UNVERIFIABLE", message: `no verifier is registered for algorithm ${s.algorithm}; the signature cannot be checked` };
  }
  if (!v.verify({ signature: s.signature, signedInfoHash: s.signedInfoHash, signerRef: s.signerRef })) {
    return { ok: false, code: "SIGNATURE_INVALID", message: "the stored signature does not verify" };
  }
  return { ok: true, method: v.method, mock: s.algorithm.startsWith("MOCK-") };
}

/**
 * Standalone detached PKCS#7 / CMS SignedData verification.
 *
 * Unlike `pdf-verify.ts` (which extracts a signature embedded in a PDF
 * /Contents dictionary), this verifies a *standalone* detached PKCS#7 blob —
 * the shape produced by a DSC signing token / eSign agent and pasted (or
 * uploaded) alongside the thing it signs. The signed content (the "message")
 * is supplied separately by the caller.
 *
 * What it verifies LOCALLY (no external third party required):
 *   1. The blob is well-formed base64 / PEM and decodes to a CMS SignedData.
 *   2. At least one signer certificate is present; the signer CN / serial /
 *      validity window are extracted.
 *   3. The certificate validity window covers "now" (not expired / not yet
 *      valid).
 *   4. The certificate asserts a signing key usage (digitalSignature or
 *      nonRepudiation) — a key-encipherment-only cert cannot sign an order.
 *   5. If `content` is supplied, the RSA signature is cryptographically
 *      verified: over the authenticated attributes (and the embedded
 *      messageDigest attribute is compared against SHA-256(content)), or —
 *      when there are no signed attributes — directly over SHA-256(content).
 *   6. Chain-to-trust: if a non-empty `trustStorePem` is supplied, the signer
 *      chain is verified against it. If NO trust store is configured the
 *      result is `chainTrusted:false` with reason "trust_store_not_configured"
 *      — FAIL CLOSED: an unconfigured deployment never reports a trusted chain.
 *
 * `ok` is the single boolean a caller should gate on. It is true only when the
 * structure parsed, the certificate is currently valid, has a signing key
 * usage, AND (when content was supplied) the cryptographic signature verified.
 * Chain trust is reported separately (`chainTrusted`) so a caller can decide
 * whether to additionally require it — a strict judicial deployment should.
 */

import forge from "node-forge";

export interface DetachedDscVerifyInput {
  /** The PKCS#7 blob — PEM-armoured (-----BEGIN PKCS7-----) or raw base64. */
  signature: string;
  /**
   * The exact bytes that were signed (the "message"). When omitted, structural
   * + certificate checks still run but the cryptographic signature is reported
   * as `signatureChecked:false` (we cannot verify a signature without content).
   */
  content?: Buffer | string | undefined;
  /**
   * Concatenated PEM of trusted CA / root certificates. When empty/undefined,
   * chain verification is skipped and `chainTrusted` is false (fail-closed).
   */
  trustStorePem?: string | undefined;
  /** Clock override for tests; defaults to now. */
  now?: Date | undefined;
}

export interface DetachedDscVerifyResult {
  /** Overall local-verification verdict (does NOT require chain trust). */
  ok: boolean;
  /** Did the blob parse as a CMS SignedData with a signer certificate? */
  structureValid: boolean;
  /** Was the RSA signature cryptographically verified (requires content)? */
  signatureChecked: boolean;
  signatureValid: boolean;
  /** Was the signer chain verified against a configured trust store? */
  chainTrusted: boolean;
  signerCN?: string | undefined;
  signerSerial?: string | undefined;
  notBefore?: string | undefined;
  notAfter?: string | undefined;
  keyUsage: string[];
  /** Machine-readable issue codes; empty when fully valid + (if asked) trusted. */
  issues: string[];
}

const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

function stripPemArmour(raw: string): string {
  const s = raw.trim();
  // Linear indexOf scan (no backtracking regex) over untrusted pasted input.
  let body = s;
  for (const label of ["PKCS7", "CMS", "SIGNED MESSAGE"]) {
    const begin = `-----BEGIN ${label}-----`;
    const end = `-----END ${label}-----`;
    const start = s.indexOf(begin);
    if (start < 0) continue;
    const from = start + begin.length;
    const stop = s.indexOf(end, from);
    if (stop < 0) continue;
    body = s.slice(from, stop);
    break;
  }
  return body.replace(/\s+/g, "");
}

/** Linear (indexOf) extraction of every PEM CERTIFICATE block in a bundle. */
function extractPemCertificates(bundle: string): string[] {
  const begin = "-----BEGIN CERTIFICATE-----";
  const end = "-----END CERTIFICATE-----";
  const out: string[] = [];
  let pos = 0;
  while (pos < bundle.length) {
    const start = bundle.indexOf(begin, pos);
    if (start < 0) break;
    const stop = bundle.indexOf(end, start + begin.length);
    if (stop < 0) break;
    out.push(bundle.slice(start, stop + end.length));
    pos = stop + end.length;
  }
  return out;
}

function extractCN(cert: forge.pki.Certificate): string {
  const cn = cert.subject.getField("CN");
  return cn ? String(cn.value) : "Unknown";
}

function extractKeyUsage(cert: forge.pki.Certificate): string[] {
  const out: string[] = [];
  const ku = cert.getExtension("keyUsage") as
    | { digitalSignature?: boolean; nonRepudiation?: boolean; keyEncipherment?: boolean; dataEncipherment?: boolean; keyAgreement?: boolean; keyCertSign?: boolean; cRLSign?: boolean }
    | undefined;
  if (ku) {
    if (ku.digitalSignature) out.push("digitalSignature");
    if (ku.nonRepudiation) out.push("nonRepudiation");
    if (ku.keyEncipherment) out.push("keyEncipherment");
    if (ku.dataEncipherment) out.push("dataEncipherment");
    if (ku.keyAgreement) out.push("keyAgreement");
    if (ku.keyCertSign) out.push("keyCertSign");
    if (ku.cRLSign) out.push("cRLSign");
  }
  return out;
}

function contentToBinary(content: Buffer | string): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return buf.toString("binary");
}

interface ParsedSignerInfo {
  authenticatedAttrsAsn1: forge.asn1.Asn1 | null;
  signatureBytes: string;
  messageDigest: string | null;
}

/**
 * Walk the CMS SignedData ASN.1 to pull out the first SignerInfo's authenticated
 * attributes, its signature bytes, and the embedded messageDigest attribute.
 * node-forge does NOT populate `msg.signers` for a parsed detached message, so
 * (as in pdf-verify.ts) we read the raw ASN.1 directly.
 */
function parseSignerInfoFromAsn1(pkcs7Asn1: forge.asn1.Asn1): ParsedSignerInfo | null {
  const contentInfo = pkcs7Asn1;
  if (!contentInfo.value || !Array.isArray(contentInfo.value)) return null;
  const civ = contentInfo.value as forge.asn1.Asn1[];
  if (civ.length < 2) return null;
  const contentWrapper = civ[1]!;
  if (!contentWrapper.value || !Array.isArray(contentWrapper.value)) return null;
  const signedData = (contentWrapper.value as forge.asn1.Asn1[])[0]!;
  if (!signedData.value || !Array.isArray(signedData.value)) return null;
  const sdv = signedData.value as forge.asn1.Asn1[];

  let signerInfosSet: forge.asn1.Asn1 | null = null;
  for (let i = sdv.length - 1; i >= 0; i--) {
    const elem = sdv[i]!;
    if (elem.type === forge.asn1.Type.SET && elem.constructed) {
      signerInfosSet = elem;
      break;
    }
  }
  if (!signerInfosSet || !Array.isArray(signerInfosSet.value)) return null;
  const siArr = signerInfosSet.value as forge.asn1.Asn1[];
  if (siArr.length === 0) return null;
  const signerInfo = siArr[0]!;
  if (!Array.isArray(signerInfo.value)) return null;
  const siValues = signerInfo.value as forge.asn1.Asn1[];

  let authenticatedAttrsAsn1: forge.asn1.Asn1 | null = null;
  let signatureBytes = "";
  let messageDigest: string | null = null;

  for (const elem of siValues) {
    if (elem.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && elem.type === 0 && elem.constructed) {
      authenticatedAttrsAsn1 = elem;
      if (Array.isArray(elem.value)) {
        for (const attr of elem.value as forge.asn1.Asn1[]) {
          if (!Array.isArray(attr.value)) continue;
          const seq = attr.value as forge.asn1.Asn1[];
          if (seq.length < 2) continue;
          let oid = "";
          try {
            oid = forge.asn1.derToOid(seq[0]!.value as string);
          } catch {
            continue;
          }
          if (oid === MESSAGE_DIGEST_OID && Array.isArray(seq[1]!.value)) {
            const dv = (seq[1]!.value as forge.asn1.Asn1[])[0];
            if (dv) messageDigest = dv.value as string;
          }
        }
      }
    }
    if (elem.type === forge.asn1.Type.OCTETSTRING && !elem.constructed) {
      signatureBytes = elem.value as string;
    }
  }
  if (!signatureBytes) return null;
  return { authenticatedAttrsAsn1, signatureBytes, messageDigest };
}

/**
 * Verify a standalone detached PKCS#7/CMS signature. Never throws for a
 * malformed blob — returns `ok:false` with issue codes instead, so a caller
 * can map it to a clean 4xx without leaking internals.
 */
export function verifyDetachedPkcs7(input: DetachedDscVerifyInput): DetachedDscVerifyResult {
  const issues: string[] = [];
  const now = input.now ?? new Date();

  const base = (): DetachedDscVerifyResult => ({
    ok: false,
    structureValid: false,
    signatureChecked: false,
    signatureValid: false,
    chainTrusted: false,
    keyUsage: [],
    issues,
  });

  // ── Decode base64 / PEM → DER ────────────────────────────────────────────
  let der: string;
  try {
    const b64 = stripPemArmour(input.signature);
    if (b64.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
      issues.push("malformed_base64");
      return base();
    }
    der = forge.util.decode64(b64);
    if (!der || der.length === 0) {
      issues.push("malformed_base64");
      return base();
    }
  } catch {
    issues.push("malformed_base64");
    return base();
  }

  // ── Parse CMS SignedData ──────────────────────────────────────────────────
  let p7: forge.pkcs7.PkcsSignedData;
  let pkcs7Asn1: forge.asn1.Asn1;
  try {
    pkcs7Asn1 = forge.asn1.fromDer(der);
    const msg = forge.pkcs7.messageFromAsn1(pkcs7Asn1);
    p7 = msg as forge.pkcs7.PkcsSignedData;
  } catch {
    issues.push("invalid_pkcs7");
    return base();
  }

  const certs = (p7 as unknown as { certificates?: forge.pki.Certificate[] }).certificates;
  if (!certs || certs.length === 0) {
    issues.push("no_certificate");
    return base();
  }
  const signerCert = certs[0]!;
  const signerCN = extractCN(signerCert);
  const signerSerial = signerCert.serialNumber;
  const notBefore = signerCert.validity.notBefore;
  const notAfter = signerCert.validity.notAfter;
  const keyUsage = extractKeyUsage(signerCert);

  const result: DetachedDscVerifyResult = {
    ok: false,
    structureValid: true,
    signatureChecked: false,
    signatureValid: false,
    chainTrusted: false,
    signerCN,
    signerSerial,
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    keyUsage,
    issues,
  };

  // ── Certificate validity window ───────────────────────────────────────────
  if (now > notAfter) issues.push("certificate_expired");
  if (now < notBefore) issues.push("certificate_not_yet_valid");

  // ── Signing key usage ─────────────────────────────────────────────────────
  if (keyUsage.length > 0 && !keyUsage.includes("digitalSignature") && !keyUsage.includes("nonRepudiation")) {
    issues.push("certificate_not_a_signing_cert");
  }

  // ── Cryptographic signature verification (requires the signed content) ─────
  if (input.content !== undefined) {
    result.signatureChecked = true;
    try {
      const binary = contentToBinary(input.content);

      // SHA-256 over the supplied content (the detached "message").
      const md = forge.md.sha256.create();
      md.update(binary);
      const contentDigest = md.digest().getBytes();

      const signerInfo = parseSignerInfoFromAsn1(pkcs7Asn1);
      if (!signerInfo) {
        issues.push("no_signer_info");
        result.signatureValid = false;
      } else {
        const publicKey = signerCert.publicKey as forge.pki.rsa.PublicKey;

        if (signerInfo.authenticatedAttrsAsn1) {
          // RFC 5652 §5.4: the signature covers the DER of the signed
          // attributes, with the IMPLICIT [0] tag (0xA0) replaced by the
          // SET OF tag (0x31).
          const attrsDer = forge.asn1.toDer(signerInfo.authenticatedAttrsAsn1).getBytes();
          const signedAttrBytes = "\x31" + attrsDer.substring(1);
          const attrMd = forge.md.sha256.create();
          attrMd.update(signedAttrBytes);

          let rsaValid = false;
          try {
            rsaValid = publicKey.verify(attrMd.digest().getBytes(), signerInfo.signatureBytes);
          } catch {
            rsaValid = false;
          }

          // Content integrity: the signed messageDigest attribute must equal
          // SHA-256(content). A tampered message is caught here.
          const digestMatched =
            signerInfo.messageDigest === null ? null : signerInfo.messageDigest === contentDigest;

          if (!rsaValid) {
            issues.push("signature_invalid");
            result.signatureValid = false;
          } else if (digestMatched === false) {
            issues.push("digest_mismatch");
            result.signatureValid = false;
          } else {
            result.signatureValid = true;
          }
        } else {
          // No signed attributes — verify the RSA signature directly over the
          // content digest.
          let rsaValid = false;
          try {
            rsaValid = publicKey.verify(contentDigest, signerInfo.signatureBytes);
          } catch {
            rsaValid = false;
          }
          if (!rsaValid) {
            issues.push("signature_invalid");
            result.signatureValid = false;
          } else {
            result.signatureValid = true;
          }
        }
      }
    } catch {
      issues.push("verification_error");
      result.signatureValid = false;
    }
  }

  // ── Chain-to-trust (fail-closed when no trust store configured) ────────────
  const trust = (input.trustStorePem ?? "").trim();
  if (trust.length === 0) {
    issues.push("trust_store_not_configured");
    result.chainTrusted = false;
  } else {
    try {
      const caStore = forge.pki.createCaStore();
      // Load every PEM certificate in the bundle.
      const pemBlocks = extractPemCertificates(trust);
      for (const block of pemBlocks) {
        try {
          caStore.addCertificate(forge.pki.certificateFromPem(block));
        } catch {
          /* skip an unparseable block */
        }
      }
      const chain = [signerCert, ...certs.slice(1)];
      result.chainTrusted = forge.pki.verifyCertificateChain(caStore, chain);
      if (!result.chainTrusted) issues.push("chain_untrusted");
    } catch {
      issues.push("chain_untrusted");
      result.chainTrusted = false;
    }
  }

  // ── Overall verdict ───────────────────────────────────────────────────────
  // ok = structure parsed + cert currently valid + has a signing key usage +
  // (when content supplied) the signature verified. Chain trust is reported
  // separately so the caller can require it in strict mode.
  const blocking = issues.some((i) =>
    i === "certificate_expired" ||
    i === "certificate_not_yet_valid" ||
    i === "certificate_not_a_signing_cert" ||
    i === "digest_mismatch" ||
    i === "signature_invalid" ||
    i === "verification_error",
  );
  result.ok = result.structureValid && !blocking && (!result.signatureChecked || result.signatureValid);
  result.issues = issues;
  return result;
}

// ─── Signing (companion to verifyDetachedPkcs7) ─────────────────────────────

export interface DetachedSignInput {
  /** The content to sign (same bytes the verifier is given). */
  content: Buffer | string;
  /** PEM of the signer's private key. */
  privateKeyPem: string;
  /** PEM of the signer's certificate. */
  certificatePem: string;
  /** Optional CA chain PEMs to embed (signer first is added automatically). */
  caChainPem?: string[] | undefined;
  /** Signing time; defaults to now. */
  signingTime?: Date | undefined;
}

/**
 * Produce a base64 detached PKCS#7/CMS SignedData over `content`, matching what
 * a DSC token/eSign agent emits and what `verifyDetachedPkcs7` consumes. This
 * is the symmetric companion to the verifier — used by server-side flows that
 * can sign locally and by tests that must produce a genuine signature to prove
 * verification actually works end to end.
 */
export function signDetachedPkcs7(input: DetachedSignInput): string {
  const binary = contentToBinary(input.content);
  const privateKey = forge.pki.privateKeyFromPem(input.privateKeyPem);
  const certificate = forge.pki.certificateFromPem(input.certificatePem);
  const signDate = input.signingTime ?? new Date();

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(binary, "raw");
  p7.addCertificate(certificate);
  for (const caPem of input.caChainPem ?? []) {
    try {
      p7.addCertificate(forge.pki.certificateFromPem(caPem));
    } catch {
      /* skip an unparseable CA cert */
    }
  }

  const sha256Oid = forge.pki.oids["sha256"] ?? "2.16.840.1.101.3.4.2.1";
  const contentTypeOid = forge.pki.oids["contentType"] ?? "1.2.840.113549.1.9.3";
  const dataOid = forge.pki.oids["data"] ?? "1.2.840.113549.1.7.1";
  const signingTimeOid = forge.pki.oids["signingTime"] ?? "1.2.840.113549.1.9.5";
  const messageDigestOid = forge.pki.oids["messageDigest"] ?? MESSAGE_DIGEST_OID;

  p7.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: sha256Oid,
    authenticatedAttributes: [
      { type: contentTypeOid, value: dataOid },
      { type: signingTimeOid, value: signDate.toISOString() },
      { type: messageDigestOid, value: "" },
    ],
  });

  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

// ─── Test / dev support: ad-hoc self-signed DSC keypair ─────────────────────

export interface GeneratedDscKeypair {
  privateKeyPem: string;
  certificatePem: string;
  /** The self-signed certificate PEM, usable as its own trust root. */
  trustPem: string;
  subjectCN: string;
}

/**
 * Generate a self-signed RSA signing certificate for DEV / TEST use (e.g. to
 * exercise the sign → verify path without a real DSC token). NOT for production
 * signing — a real DSC comes from a CCA-licensed token/CA. Exposed because the
 * render package owns node-forge; callers (service tests) otherwise have no way
 * to produce a genuine signature to prove verification works.
 */
export function generateTestDscKeypair(
  opts: { cn?: string; notBefore?: Date; notAfter?: Date; digitalSignature?: boolean } = {},
): GeneratedDscKeypair {
  const subjectCN = opts.cn ?? "Test DSC Signer";
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + Math.floor(Math.random() * 1e9).toString(16);
  const now = new Date();
  cert.validity.notBefore = opts.notBefore ?? new Date(now.getTime() - 24 * 3600 * 1000);
  cert.validity.notAfter = opts.notAfter ?? new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const attrs = [{ name: "commonName", value: subjectCN }, { name: "countryName", value: "IN" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", digitalSignature: opts.digitalSignature ?? true, nonRepudiation: true, keyCertSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem,
    trustPem: certificatePem,
    subjectCN,
  };
}

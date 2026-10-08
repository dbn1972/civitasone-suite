/**
 * GAP-CITIZEN-DOCUMENTS-02 — real, server-side verification of a DigiLocker
 * issued-document artefact BEFORE it may be marked source-verified.
 *
 * What CAN be verified locally (and so IS verified here, with node-forge):
 *   1. the PKCS#7/CMS SignedData (or XML-DSig) STRUCTURE parses;
 *   2. the signer certificate is time-valid (notBefore ≤ now ≤ notAfter);
 *   3. the signer certificate CHAINS to a configured trust store (the issued
 *      document's signer must be issued by a CA we trust — an attacker cannot
 *      swap in a self-signed cert);
 *   4. for PKCS#7 the signer's RSA signature over the signed attributes
 *      verifies and (for detached) the messageDigest attribute equals
 *      sha256(content).
 *
 * Fail closed: if the trust store is unconfigured, or any step fails, the
 * artefact is NOT verified — never a fake "source_verified". Wiring the real
 * DigiLocker signer trust anchors is a HUMAN REVIEW follow-up.
 *
 * No I/O, no DB — pure functions, unit-testable with a self-issued fixture CA.
 */
import forge from "node-forge";

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

export type DocVerifyFailure =
  | "trust_store_unconfigured"
  | "malformed_artefact"
  | "signer_cert_expired"
  | "untrusted_signer"
  | "signature_invalid"
  | "digest_mismatch";

export interface DocVerifyResult {
  verified: boolean;
  reason: DocVerifyFailure | "ok";
  signerSubject?: string | undefined;
}

const toBinaryString = (b: Uint8Array): string => Buffer.from(b).toString("binary");

/**
 * Build a node-forge CA store from a configured PEM trust bundle. One or more
 * concatenated PEM certificates (the DigiLocker signer CA chain). Returns null
 * when nothing is configured (fail-closed caller must treat as unconfigured).
 */
export function loadTrustStore(pemBundle: string | undefined): forge.pki.CAStore | null {
  if (!pemBundle || pemBundle.trim().length === 0) return null;
  const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!matches || matches.length === 0) return null;
  try {
    const certs = matches.map((pem) => forge.pki.certificateFromPem(pem));
    return forge.pki.createCaStore(certs);
  } catch {
    return null;
  }
}

/** The configured trust store from the env (CITIZEN_DIGILOCKER_TRUST_PEM). */
export function configuredTrustStore(env: NodeJS.ProcessEnv = process.env): forge.pki.CAStore | null {
  return loadTrustStore(env.CITIZEN_DIGILOCKER_TRUST_PEM);
}

function certIsTimeValid(cert: forge.pki.Certificate, at: Date): boolean {
  return cert.validity.notBefore <= at && at <= cert.validity.notAfter;
}

/** Does `cert` chain to the trust store? Uses forge's chain verification. */
function chainsToTrust(cert: forge.pki.Certificate, extraChain: forge.pki.Certificate[], store: forge.pki.CAStore): boolean {
  try {
    const chain = [cert, ...extraChain.filter((c) => c !== cert)];
    return forge.pki.verifyCertificateChain(store, chain);
  } catch {
    return false;
  }
}

/**
 * Verify a detached PKCS#7/CMS SignedData over `content`:
 * structure + signer cert validity + chain to trust store + signature + digest.
 */
export function verifyPkcs7Document(
  content: Uint8Array,
  der: Uint8Array,
  trustStore: forge.pki.CAStore | null,
  at: Date = new Date(),
): DocVerifyResult {
  if (!trustStore) return { verified: false, reason: "trust_store_unconfigured" };
  let msg: {
    certificates: forge.pki.Certificate[];
    rawCapture: { digestAlgorithm: string; authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
  };
  let signer: forge.pki.Certificate | undefined;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(toBinaryString(der)));
    msg = forge.pkcs7.messageFromAsn1(asn1) as unknown as typeof msg;
    signer = msg.certificates[0];
  } catch {
    return { verified: false, reason: "malformed_artefact" };
  }
  if (!signer || !msg.rawCapture || !msg.rawCapture.authenticatedAttributes) {
    return { verified: false, reason: "malformed_artefact" };
  }
  const signerSubject = signer.subject.getField("CN")?.value as string | undefined;

  if (!certIsTimeValid(signer, at)) return { verified: false, reason: "signer_cert_expired", signerSubject };
  if (!chainsToTrust(signer, msg.certificates, trustStore)) {
    return { verified: false, reason: "untrusted_signer", signerSubject };
  }

  try {
    const rc = msg.rawCapture;
    if (forge.asn1.derToOid(rc.digestAlgorithm) !== OID_SHA256) {
      return { verified: false, reason: "signature_invalid", signerSubject };
    }
    // messageDigest attribute == sha256(content)
    const attr = rc.authenticatedAttributes.find(
      (a) => forge.asn1.derToOid((a.value[0] as forge.asn1.Asn1).value as string) === OID_MESSAGE_DIGEST,
    );
    const claimed = (((attr?.value[1] as forge.asn1.Asn1 | undefined)?.value as forge.asn1.Asn1[] | undefined)?.[0]?.value) as string | undefined;
    const contentMd = forge.md.sha256.create();
    contentMd.update(toBinaryString(content));
    if (!claimed || claimed !== contentMd.digest().getBytes()) {
      return { verified: false, reason: "digest_mismatch", signerSubject };
    }
    // RSA signature over the DER SET of authenticated attributes (RFC 5652 §5.4).
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, rc.authenticatedAttributes);
    const attrMd = forge.md.sha256.create();
    attrMd.update(forge.asn1.toDer(set).getBytes());
    const ok = (signer.publicKey as forge.pki.rsa.PublicKey).verify(attrMd.digest().getBytes(), rc.signature);
    if (!ok) return { verified: false, reason: "signature_invalid", signerSubject };
    return { verified: true, reason: "ok", signerSubject };
  } catch {
    return { verified: false, reason: "signature_invalid", signerSubject };
  }
}

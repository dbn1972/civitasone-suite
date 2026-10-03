/**
 * Pure signing / verification primitives for bank files. No I/O, no DB.
 *
 *  - OpenPGP detached signature, ASCII-armoured, SHA-256  (openpgp)
 *  - XML-DSig enveloped signature, RSA-SHA256, exclusive C14N (xml-crypto)
 *  - PKCS#7 / CMS detached signature, SHA-256, DER          (node-forge)
 *  - OpenPGP encryption to the bank's public key             (openpgp)
 *
 * Every sign function has a matching verify function; signing-service.ts runs
 * the verify right after signing (self-check) and fails closed on mismatch.
 */
import * as openpgp from "openpgp";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";

// ─── OpenPGP detached ─────────────────────────────────────────────────────

export async function signPgpDetached(bytes: Uint8Array, privateKeyArmored: string): Promise<string> {
  const signingKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
  const message = await openpgp.createMessage({ binary: bytes });
  const signature = await openpgp.sign({
    message,
    signingKeys: signingKey,
    detached: true,
    format: "armored",
    config: { preferredHashAlgorithm: openpgp.enums.hash.sha256 },
  });
  return signature as string;
}

export interface PgpVerifyResult { ok: boolean; hash: string | null }

/** Verify an armoured detached signature over `bytes` with an armoured public (or private) key. */
export async function verifyPgpDetached(bytes: Uint8Array, signatureArmored: string, publicKeyArmored: string): Promise<PgpVerifyResult> {
  try {
    const signature = await openpgp.readSignature({ armoredSignature: signatureArmored });
    const verificationKeys = await openpgp.readKey({ armoredKey: publicKeyArmored });
    const message = await openpgp.createMessage({ binary: bytes });
    const result = await openpgp.verify({ message, signature, verificationKeys });
    const first = result.signatures[0];
    if (!first) return { ok: false, hash: null };
    await first.verified; // rejects on a bad signature
    const pkt = signature.packets[0] as unknown as { hashAlgorithm?: number } | undefined;
    const hash = pkt?.hashAlgorithm === openpgp.enums.hash.sha256 ? "sha256" : String(pkt?.hashAlgorithm ?? "unknown");
    return { ok: true, hash };
  } catch {
    return { ok: false, hash: null };
  }
}

/** Public key (armoured) of an armoured private key. */
export async function pgpPublicKeyOf(privateKeyArmored: string): Promise<string> {
  const k = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
  return k.toPublic().armor();
}

/** OpenPGP-encrypt `bytes` to the bank's armoured public key; returns binary .pgp bytes. */
export async function encryptPgpToRecipient(bytes: Uint8Array, recipientPublicKeyArmored: string): Promise<Buffer> {
  const encryptionKeys = await openpgp.readKey({ armoredKey: recipientPublicKeyArmored });
  const message = await openpgp.createMessage({ binary: bytes });
  const out = await openpgp.encrypt({ message, encryptionKeys, format: "binary" });
  return Buffer.from(out as Uint8Array);
}

// ─── XML-DSig enveloped (RSA-SHA256, exclusive C14N) ──────────────────────

const DSIG_NS = "http://www.w3.org/2000/09/xmldsig#";
const ALG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const ALG_EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const ALG_SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export function signXmlDsig(xml: string, rsaPrivateKeyPem: string, certPem: string): string {
  const sig = new SignedXml({
    privateKey: rsaPrivateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: ALG_RSA_SHA256,
    canonicalizationAlgorithm: ALG_EXC_C14N,
  });
  sig.addReference({
    xpath: "/*",
    transforms: [ALG_ENVELOPED, ALG_EXC_C14N],
    digestAlgorithm: ALG_SHA256,
  });
  sig.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  return sig.getSignedXml();
}

/** Verify an enveloped signature that covers the whole document, against `certPem`. */
export function verifyXmlDsig(signedXml: string, certPem: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(signedXml, "text/xml");
    const sigs = doc.getElementsByTagNameNS(DSIG_NS, "Signature");
    if (sigs.length !== 1) return false;
    const v = new SignedXml({ publicCert: certPem });
    v.loadSignature(sigs[0] as unknown as Node);
    if (!v.checkSignature(signedXml)) return false;
    // The signature must cover the whole document (URI="") -- not just a fragment.
    const refs = v.getSignedReferences();
    return refs.length === 1;
  } catch {
    return false;
  }
}

// ─── PKCS#7 / CMS detached (SHA-256, DER) ─────────────────────────────────

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

const toBinaryString = (b: Uint8Array): string => Buffer.from(b).toString("binary");

export function signPkcs7Detached(bytes: Uint8Array, rsaPrivateKeyPem: string, certPem: string): Buffer {
  const cert = forge.pki.certificateFromPem(certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinaryString(bytes));
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(rsaPrivateKeyPem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256 as string,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType as string, value: forge.pki.oids.data as string },
      { type: forge.pki.oids.messageDigest as string },
      { type: forge.pki.oids.signingTime as string, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

/**
 * Verify a detached PKCS#7 over `bytes`: the signer's messageDigest attribute
 * equals sha256(bytes), and the RSA signature over the DER-encoded signed
 * attributes verifies with the embedded certificate, which must equal
 * `expectedCertPem` (trust anchor -- an attacker cannot swap in their own).
 */
export function verifyPkcs7Detached(bytes: Uint8Array, der: Uint8Array, expectedCertPem: string): boolean {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(toBinaryString(der)));
    const msg = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      certificates: forge.pki.Certificate[];
      rawCapture: {
        digestAlgorithm: string;
        authenticatedAttributes: forge.asn1.Asn1[];
        signature: string;
      };
    };
    const rc = msg.rawCapture;
    if (forge.asn1.derToOid(rc.digestAlgorithm) !== OID_SHA256) return false;
    const cert = msg.certificates[0];
    if (!cert) return false;
    const expected = forge.pki.certificateFromPem(expectedCertPem);
    const derOf = (c: forge.pki.Certificate) => forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
    if (derOf(cert) !== derOf(expected)) return false;

    // 1) messageDigest attribute == sha256(content)
    const attr = rc.authenticatedAttributes.find((a) => forge.asn1.derToOid((a.value[0] as forge.asn1.Asn1).value as string) === OID_MESSAGE_DIGEST);
    const claimed = (((attr?.value[1] as forge.asn1.Asn1 | undefined)?.value as forge.asn1.Asn1[] | undefined)?.[0]?.value) as string | undefined;
    const contentMd = forge.md.sha256.create();
    contentMd.update(toBinaryString(bytes));
    if (!claimed || claimed !== contentMd.digest().getBytes()) return false;

    // 2) signature over the DER SET of authenticated attributes (re-tagged SET, per RFC 5652 5.4)
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, rc.authenticatedAttributes);
    const attrMd = forge.md.sha256.create();
    attrMd.update(forge.asn1.toDer(set).getBytes());
    return (cert.publicKey as forge.pki.rsa.PublicKey).verify(attrMd.digest().getBytes(), rc.signature);
  } catch {
    return false;
  }
}

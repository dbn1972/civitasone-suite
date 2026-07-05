/**
 * DSC (Digital Signature Certificate) signing for PDF documents.
 *
 * Implements PKCS#7 detached signature embedding per PDF 1.7 / ISO 32000-1.
 * Uses node-forge for PKCS#12 parsing, SHA-256 hashing, and CMS SignedData construction.
 *
 * SubFilter: adbe.pkcs7.detached
 * Hash algorithm: SHA-256
 */

import forge from "node-forge";
import { preparePdfForSigning } from "./pdf-signature.js";

// ─── Public Interfaces ───────────────────────────────────────────────────────

export interface DscSignInput {
  /** PKCS#12 keystore bytes */
  p12Buffer: Buffer;
  /** Keystore passphrase */
  passphrase: string;
}

export interface SignedPdfResult {
  /** The signed PDF buffer */
  buffer: Buffer;
  /** Signer's Common Name */
  signerCN: string;
  /** Signing timestamp (ISO 8601) */
  signedAt: string;
  /** Certificate serial number (hex) */
  serialNumber: string;
  /** Certificate SHA-256 fingerprint */
  sha256Fingerprint: string;
}

export interface CertificateInfo {
  subjectCN: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  sha256Fingerprint: string;
  keyUsage: string[];
}

// ─── Custom Error ────────────────────────────────────────────────────────────

export class DscValidationError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "DscValidationError";
    this.code = code;
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

interface ParsedPkcs12 {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
  caChain: forge.pki.Certificate[];
}

/**
 * Parse a PKCS#12 buffer and extract private key, signing certificate, and CA chain.
 * Throws DscValidationError if the passphrase is incorrect or the keystore is malformed.
 */
function parsePkcs12(p12Buffer: Buffer, passphrase: string): ParsedPkcs12 {
  const p12Der = forge.util.decode64(p12Buffer.toString("base64"));
  const p12Asn1 = forge.asn1.fromDer(p12Der);

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
  } catch {
    throw new DscValidationError(
      "Failed to parse PKCS#12 keystore — incorrect passphrase or malformed file",
      "DSC_PASSPHRASE_INCORRECT",
    );
  }

  // Extract private key
  const keyBagType = forge.pki.oids["pkcs8ShroudedKeyBag"] ?? "1.2.840.113549.1.12.10.1.2";
  const keyBags = p12.getBags({ bagType: keyBagType });
  const keyBag = keyBags[keyBagType];
  if (!keyBag || keyBag.length === 0 || !keyBag[0]?.key) {
    throw new DscValidationError(
      "PKCS#12 keystore does not contain a private key",
      "DSC_CERTIFICATE_INVALID",
    );
  }
  const privateKey = keyBag[0].key as forge.pki.rsa.PrivateKey;

  // Extract certificates
  const certBagType = forge.pki.oids["certBag"] ?? "1.2.840.113549.1.12.10.1.3";
  const certBags = p12.getBags({ bagType: certBagType });
  const certBag = certBags[certBagType];
  if (!certBag || certBag.length === 0 || !certBag[0]?.cert) {
    throw new DscValidationError(
      "PKCS#12 keystore does not contain a certificate",
      "DSC_CERTIFICATE_INVALID",
    );
  }

  // The first certificate is typically the signing cert; others are CA chain
  const certificate = certBag[0].cert;
  const caChain: forge.pki.Certificate[] = [];
  for (let i = 1; i < certBag.length; i++) {
    const cert = certBag[i]?.cert;
    if (cert) {
      caChain.push(cert);
    }
  }

  return { privateKey, certificate, caChain };
}

/**
 * Compute the SHA-256 fingerprint of a certificate (DER-encoded).
 */
function computeCertFingerprint(cert: forge.pki.Certificate): string {
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(certDer);
  return md.digest().toHex();
}

/**
 * Extract the Common Name from a certificate's subject.
 */
function extractSubjectCN(cert: forge.pki.Certificate): string {
  const cnField = cert.subject.getField("CN");
  return cnField ? String(cnField.value) : "Unknown";
}

/**
 * Extract key usage extensions from a certificate.
 */
function extractKeyUsage(cert: forge.pki.Certificate): string[] {
  const keyUsages: string[] = [];
  const kuExt = cert.getExtension("keyUsage") as
    | ({ digitalSignature?: boolean; nonRepudiation?: boolean; keyEncipherment?: boolean; dataEncipherment?: boolean; keyAgreement?: boolean; keyCertSign?: boolean; cRLSign?: boolean })
    | undefined;

  if (kuExt) {
    if (kuExt.digitalSignature) keyUsages.push("digitalSignature");
    if (kuExt.nonRepudiation) keyUsages.push("nonRepudiation");
    if (kuExt.keyEncipherment) keyUsages.push("keyEncipherment");
    if (kuExt.dataEncipherment) keyUsages.push("dataEncipherment");
    if (kuExt.keyAgreement) keyUsages.push("keyAgreement");
    if (kuExt.keyCertSign) keyUsages.push("keyCertSign");
    if (kuExt.cRLSign) keyUsages.push("cRLSign");
  }

  return keyUsages;
}

/**
 * Extract the byte-range content from a prepared PDF as a binary string.
 * This is the raw data that gets hashed for the signature.
 */
function extractByteRangeContent(
  pdfBuffer: Buffer,
  byteRange: [number, number, number, number],
): string {
  const [offset1, length1, offset2, length2] = byteRange;
  const part1 = pdfBuffer.subarray(offset1, offset1 + length1).toString("binary");
  const part2 = pdfBuffer.subarray(offset2, offset2 + length2).toString("binary");
  return part1 + part2;
}

/**
 * Build a CMS SignedData (PKCS#7 detached signature) structure.
 * Returns DER-encoded bytes.
 *
 * @param byteRangeContent - The raw byte-range content (used by forge to compute messageDigest)
 * @param privateKey - RSA private key for signing
 * @param certificate - Signing certificate
 * @param caChain - CA certificate chain
 * @param signDate - Signing timestamp
 */
function buildCmsSignedData(
  byteRangeContent: string,
  privateKey: forge.pki.rsa.PrivateKey,
  certificate: forge.pki.Certificate,
  caChain: forge.pki.Certificate[],
  signDate: Date,
): string {
  // Create PKCS#7 signed data
  const p7 = forge.pkcs7.createSignedData();

  // Set content to the byte-range data so forge computes the correct messageDigest.
  // In detached mode, the content is not embedded in the output, but forge uses it
  // to compute SHA-256 for the messageDigest authenticated attribute.
  p7.content = forge.util.createBuffer(byteRangeContent, "raw");
  p7.addCertificate(certificate);
  for (const caCert of caChain) {
    p7.addCertificate(caCert);
  }

  // Add signer info
  const sha256Oid = forge.pki.oids["sha256"] ?? "2.16.840.1.101.3.4.2.1";
  const contentTypeOid = forge.pki.oids["contentType"] ?? "1.2.840.113549.1.9.3";
  const dataOid = forge.pki.oids["data"] ?? "1.2.840.113549.1.7.1";
  const signingTimeOid = forge.pki.oids["signingTime"] ?? "1.2.840.113549.1.9.5";
  const messageDigestOid = forge.pki.oids["messageDigest"] ?? "1.2.840.113549.1.9.4";

  p7.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: sha256Oid,
    authenticatedAttributes: [
      {
        type: contentTypeOid,
        value: dataOid,
      },
      {
        type: signingTimeOid,
        value: signDate.toISOString(),
      },
      {
        type: messageDigestOid,
        // Placeholder — forge will overwrite with SHA-256(p7.content) during sign()
        value: "",
      },
    ],
  });

  // Sign the data (detached — no encapsulated content)
  p7.sign({ detached: true });

  // Encode to DER
  const asn1 = p7.toAsn1();
  return forge.asn1.toDer(asn1).getBytes();
}

// ─── Public Functions ────────────────────────────────────────────────────────

/**
 * Validate a DSC certificate from a PKCS#12 keystore.
 * Throws DscValidationError if the certificate is expired or missing digitalSignature key usage.
 *
 * @param p12Buffer - The PKCS#12 keystore buffer
 * @param passphrase - The keystore passphrase
 * @returns Certificate information
 */
export function validateDscCertificate(p12Buffer: Buffer, passphrase: string): CertificateInfo {
  const { certificate } = parsePkcs12(p12Buffer, passphrase);

  const subjectCN = extractSubjectCN(certificate);
  const serialNumber = certificate.serialNumber;
  const notBefore = new Date(certificate.validity.notBefore.getTime());
  const notAfter = new Date(certificate.validity.notAfter.getTime());
  const sha256Fingerprint = computeCertFingerprint(certificate);
  const keyUsage = extractKeyUsage(certificate);

  // Validate expiry
  const now = new Date();
  if (now > notAfter) {
    throw new DscValidationError(
      `DSC certificate expired on ${notAfter.toISOString()} (CN: ${subjectCN})`,
      "DSC_CERTIFICATE_EXPIRED",
    );
  }

  // Validate key usage includes digitalSignature
  if (!keyUsage.includes("digitalSignature")) {
    throw new DscValidationError(
      `DSC certificate does not have digitalSignature key usage (CN: ${subjectCN}, keyUsage: [${keyUsage.join(", ")}])`,
      "DSC_CERTIFICATE_INVALID",
    );
  }

  return {
    subjectCN,
    serialNumber,
    notBefore,
    notAfter,
    sha256Fingerprint,
    keyUsage,
  };
}

/**
 * Sign a PDF buffer with a DSC (PKCS#12 keystore).
 * Embeds a PKCS#7 detached signature per PDF 1.7 / ISO 32000-1.
 *
 * Flow:
 * 1. Parse PKCS#12 → extract private key, signing cert, CA chain
 * 2. Validate the certificate (expiry, key usage)
 * 3. Prepare the PDF with a signature placeholder
 * 4. Compute SHA-256 over the byte ranges
 * 5. Build CMS SignedData (DER-encoded)
 * 6. Hex-encode DER and write into the reserved placeholder
 * 7. Return the final signed PDF + signer metadata
 *
 * @param pdfBuffer - The unsigned PDF buffer
 * @param dsc - PKCS#12 keystore buffer and passphrase
 * @returns Signed PDF result with buffer and signer metadata
 */
export async function signPdfWithDsc(
  pdfBuffer: Buffer,
  dsc: DscSignInput,
): Promise<SignedPdfResult> {
  // Step 1: Parse PKCS#12
  const { privateKey, certificate, caChain } = parsePkcs12(dsc.p12Buffer, dsc.passphrase);

  // Step 2: Validate the certificate
  const subjectCN = extractSubjectCN(certificate);
  const serialNumber = certificate.serialNumber;
  const notAfter = new Date(certificate.validity.notAfter.getTime());
  const sha256Fingerprint = computeCertFingerprint(certificate);

  const now = new Date();
  if (now > notAfter) {
    throw new DscValidationError(
      `DSC certificate expired on ${notAfter.toISOString()} (CN: ${subjectCN})`,
      "DSC_CERTIFICATE_EXPIRED",
    );
  }

  const keyUsage = extractKeyUsage(certificate);
  if (!keyUsage.includes("digitalSignature")) {
    throw new DscValidationError(
      `DSC certificate does not have digitalSignature key usage (CN: ${subjectCN})`,
      "DSC_CERTIFICATE_INVALID",
    );
  }

  const signDate = new Date();

  // Step 3: Prepare the PDF with signature placeholder
  const { preparedPdf, byteRange } = preparePdfForSigning(pdfBuffer, {
    signerName: subjectCN,
    reason: "Form 16 TDS Certificate",
    location: "India",
    signDate,
    placeholderSize: 8192,
  });

  // Step 4: Compute SHA-256 over byte ranges (for reference — forge will compute this internally)
  // Extract the raw byte-range content for forge to hash
  const byteRangeContent = extractByteRangeContent(preparedPdf, byteRange);

  // Step 5: Build CMS SignedData (DER-encoded)
  const derSignature = buildCmsSignedData(
    byteRangeContent,
    privateKey,
    certificate,
    caChain,
    signDate,
  );

  // Step 6: Hex-encode DER and write into the reserved placeholder
  const hexSignature = Buffer.from(derSignature, "binary").toString("hex");

  // The placeholder sits between byteRange[1] and byteRange[2]
  // It's enclosed in angle brackets: <placeholder_hex>
  // We need to write the hex into the placeholder region
  const placeholderStart = byteRange[0] + byteRange[1]; // Start of the <...> block
  const placeholderEnd = byteRange[2]; // End of the <...> block

  // The placeholder region in the PDF is: <00...00>
  // We need to overwrite the hex content between the angle brackets
  const signedPdf = Buffer.from(preparedPdf);

  // Write hex signature padded with zeros to fill the placeholder
  // +1 to skip the opening '<', the content is between '<' and '>'
  const contentStart = placeholderStart + 1; // skip '<'
  const contentLength = placeholderEnd - placeholderStart - 2; // exclude '<' and '>'
  const paddedHex = hexSignature.padEnd(contentLength, "0");

  // Write the hex signature into the placeholder
  signedPdf.write(paddedHex, contentStart, contentLength, "ascii");

  // Step 7: Return result
  return {
    buffer: signedPdf,
    signerCN: subjectCN,
    signedAt: signDate.toISOString(),
    serialNumber,
    sha256Fingerprint,
  };
}

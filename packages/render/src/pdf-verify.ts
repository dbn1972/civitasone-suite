/**
 * PDF Signature Verification.
 *
 * Extracts the PKCS#7 detached signature from a signed PDF and verifies:
 * 1. The PDF contains a /Sig dictionary with /ByteRange and /Contents
 * 2. The hex-encoded DER in /Contents decodes to valid CMS SignedData
 * 3. The RSA signature over the authenticated attributes is valid
 * 4. The byte ranges are consistent with the file length
 *
 * Returns signer metadata (CN, serial, signing time, certificate expiry)
 * and a list of issues if verification fails.
 *
 * Note: node-forge's detached signing stores its own content digest in the
 * messageDigest authenticated attribute. Content integrity is verified by
 * recomputing the SHA-256 over the byte ranges and comparing against the
 * digest embedded in the authenticated attributes. If the PDF is tampered
 * after signing, the byte-range content changes, and the recomputed digest
 * will not match the one embedded and signed in the PKCS#7 structure.
 */

import forge from "node-forge";

// ─── Public Interfaces ───────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  signerCN?: string | undefined;
  signedAt?: string | undefined;
  serialNumber?: string | undefined;
  certificateExpiry?: string | undefined;
  issues: string[];
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface ExtractedSignature {
  byteRange: [number, number, number, number];
  signatureHex: string;
}

/** Parsed signer information from the CMS SignedData ASN.1 */
interface ParsedSignerInfo {
  authenticatedAttrsAsn1: forge.asn1.Asn1 | null;
  signatureBytes: string;
  messageDigest: string | null;
  signingTime: string | null;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extract the /ByteRange and /Contents from a PDF buffer.
 * Returns null if the PDF does not contain a signature dictionary.
 */
function extractSignatureData(pdfBuffer: Buffer): ExtractedSignature | null {
  const pdfStr = pdfBuffer.toString("binary");

  // Find /ByteRange [offset1 length1 offset2 length2]
  const byteRangeMatch = pdfStr.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!byteRangeMatch) {
    return null;
  }

  const byteRange: [number, number, number, number] = [
    parseInt(byteRangeMatch[1]!, 10),
    parseInt(byteRangeMatch[2]!, 10),
    parseInt(byteRangeMatch[3]!, 10),
    parseInt(byteRangeMatch[4]!, 10),
  ];

  // Find /Contents <hex...>
  const contentsMatch = pdfStr.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
  if (!contentsMatch) {
    return null;
  }

  const signatureHex = contentsMatch[1]!;
  return { byteRange, signatureHex };
}

/**
 * Compute SHA-256 over the two byte ranges of the PDF.
 */
function computeByteRangeDigest(
  pdfBuffer: Buffer,
  byteRange: [number, number, number, number],
): string {
  const [offset1, length1, offset2, length2] = byteRange;
  const md = forge.md.sha256.create();
  md.update(pdfBuffer.subarray(offset1, offset1 + length1).toString("binary"));
  md.update(pdfBuffer.subarray(offset2, offset2 + length2).toString("binary"));
  return md.digest().getBytes();
}

/**
 * Extract the Common Name from a certificate's subject.
 */
function extractSubjectCN(cert: forge.pki.Certificate): string {
  const cnField = cert.subject.getField("CN");
  return cnField ? String(cnField.value) : "Unknown";
}

/**
 * Walk the CMS SignedData ASN.1 structure to extract signer information.
 *
 * CMS ContentInfo { contentType, content: SignedData }
 * SignedData { version, digestAlgorithms, encapContentInfo, [0]certs, [1]crls, signerInfos }
 * SignerInfo { version, sid, digestAlgorithm, [0]signedAttrs, signatureAlgorithm, signature }
 */
function parseSignerInfoFromAsn1(pkcs7Asn1: forge.asn1.Asn1): ParsedSignerInfo | null {
  const contentInfo = pkcs7Asn1;
  if (!contentInfo.value || !Array.isArray(contentInfo.value)) return null;

  const contentInfoValues = contentInfo.value as forge.asn1.Asn1[];
  if (contentInfoValues.length < 2) return null;

  // content is [0] EXPLICIT containing SignedData SEQUENCE
  const contentWrapper = contentInfoValues[1]!;
  if (!contentWrapper.value || !Array.isArray(contentWrapper.value)) return null;

  const signedData = (contentWrapper.value as forge.asn1.Asn1[])[0]!;
  if (!signedData.value || !Array.isArray(signedData.value)) return null;

  const signedDataValues = signedData.value as forge.asn1.Asn1[];

  // Find signerInfos SET — it's the last SET in SignedData
  let signerInfosSet: forge.asn1.Asn1 | null = null;
  for (let i = signedDataValues.length - 1; i >= 0; i--) {
    const elem = signedDataValues[i]!;
    if (elem.type === forge.asn1.Type.SET && elem.constructed) {
      signerInfosSet = elem;
      break;
    }
  }

  if (!signerInfosSet || !signerInfosSet.value || !Array.isArray(signerInfosSet.value)) return null;
  const signerInfoArr = signerInfosSet.value as forge.asn1.Asn1[];
  if (signerInfoArr.length === 0) return null;

  // First SignerInfo SEQUENCE
  const signerInfo = signerInfoArr[0]!;
  if (!signerInfo.value || !Array.isArray(signerInfo.value)) return null;

  const siValues = signerInfo.value as forge.asn1.Asn1[];

  let authenticatedAttrsAsn1: forge.asn1.Asn1 | null = null;
  let signatureBytes = "";
  let messageDigest: string | null = null;
  let signingTime: string | null = null;

  for (const elem of siValues) {
    // signedAttrs: context-specific [0] IMPLICIT constructed
    if (elem.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && elem.type === 0 && elem.constructed) {
      authenticatedAttrsAsn1 = elem;

      // Extract messageDigest and signingTime from attributes
      if (elem.value && Array.isArray(elem.value)) {
        for (const attr of elem.value as forge.asn1.Asn1[]) {
          if (!attr.value || !Array.isArray(attr.value)) continue;
          const attrSeqValues = attr.value as forge.asn1.Asn1[];
          if (attrSeqValues.length < 2) continue;

          const oidElem = attrSeqValues[0]!;
          const valueSetElem = attrSeqValues[1]!;

          let oid = "";
          try {
            oid = forge.asn1.derToOid(oidElem.value as string);
          } catch {
            continue;
          }

          const messageDigestOid = "1.2.840.113549.1.9.4";
          const signingTimeOid = "1.2.840.113549.1.9.5";

          if (oid === messageDigestOid) {
            if (valueSetElem.value && Array.isArray(valueSetElem.value)) {
              const digestVal = (valueSetElem.value as forge.asn1.Asn1[])[0];
              if (digestVal) {
                messageDigest = digestVal.value as string;
              }
            }
          } else if (oid === signingTimeOid) {
            if (valueSetElem.value && Array.isArray(valueSetElem.value)) {
              const timeVal = (valueSetElem.value as forge.asn1.Asn1[])[0];
              if (timeVal) {
                signingTime = timeVal.value as string;
              }
            }
          }
        }
      }
    }

    // signature: OCTET STRING (primitive, non-constructed)
    if (elem.type === forge.asn1.Type.OCTETSTRING && !elem.constructed) {
      signatureBytes = elem.value as string;
    }
  }

  if (!signatureBytes) return null;

  return { authenticatedAttrsAsn1, signatureBytes, messageDigest, signingTime };
}

// ─── Public Function ─────────────────────────────────────────────────────────

/**
 * Verify the PKCS#7 digital signature embedded in a PDF.
 *
 * @param pdfBuffer - The PDF buffer to verify
 * @returns VerifyResult with validity status and signer metadata
 */
export function verifyPdfSignature(pdfBuffer: Buffer): VerifyResult {
  const issues: string[] = [];

  // Step 1: Extract signature data from PDF
  const sigData = extractSignatureData(pdfBuffer);
  if (!sigData) {
    return { valid: false, issues: ["no_signature"] };
  }

  const { byteRange, signatureHex } = sigData;

  // Step 2: Decode hex → DER
  const trimmedHex = signatureHex.replace(/0+$/, "");
  if (trimmedHex.length === 0) {
    return { valid: false, issues: ["empty_signature"] };
  }

  const evenHex = trimmedHex.length % 2 === 0 ? trimmedHex : trimmedHex + "0";
  const derBytes = forge.util.hexToBytes(evenHex);

  // Step 3: Parse CMS SignedData (PKCS#7)
  let pkcs7Asn1: forge.asn1.Asn1;
  let p7: forge.pkcs7.PkcsSignedData;
  try {
    pkcs7Asn1 = forge.asn1.fromDer(derBytes);
    const msg = forge.pkcs7.messageFromAsn1(pkcs7Asn1);
    p7 = msg as forge.pkcs7.PkcsSignedData;
  } catch {
    issues.push("invalid_pkcs7");
    return { valid: false, issues };
  }

  // Step 4: Extract signer certificate
  const certs = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates;
  if (!certs || certs.length === 0) {
    issues.push("no_certificate");
    return { valid: false, issues };
  }

  const signerCert = certs[0]!;
  const signerCN = extractSubjectCN(signerCert);
  const serialNumber = signerCert.serialNumber;
  const certificateExpiry = signerCert.validity.notAfter.toISOString();

  // Step 5: Validate byte range is within bounds
  const [, , offset2, length2] = byteRange;
  if (offset2 + length2 > pdfBuffer.length) {
    issues.push("byte_range_out_of_bounds");
    return { valid: false, signerCN, serialNumber, certificateExpiry, issues };
  }

  // Step 6: Compute SHA-256 over the byte ranges for tamper detection
  const computedDigest = computeByteRangeDigest(pdfBuffer, byteRange);

  // Step 7: Parse signer info from raw ASN.1
  let signedAt: string | undefined;

  try {
    const signerInfo = parseSignerInfoFromAsn1(pkcs7Asn1);
    if (!signerInfo) {
      issues.push("no_signer_info");
    } else {
      signedAt = signerInfo.signingTime ?? undefined;

      if (signerInfo.authenticatedAttrsAsn1) {
        // Verify RSA signature over the authenticated attributes.
        // Per CMS (RFC 5652 §5.4), the signature covers the DER encoding of
        // the authenticated attributes with the IMPLICIT [0] tag (0xA0)
        // replaced by a SET OF tag (0x31).
        const attrsDer = forge.asn1.toDer(signerInfo.authenticatedAttrsAsn1).getBytes();
        const signedAttrBytes = "\x31" + attrsDer.substring(1);

        const attrMd = forge.md.sha256.create();
        attrMd.update(signedAttrBytes);

        const publicKey = signerCert.publicKey as forge.pki.rsa.PublicKey;
        const rsaValid = publicKey.verify(
          attrMd.digest().getBytes(),
          signerInfo.signatureBytes,
        );

        if (!rsaValid) {
          issues.push("signature_invalid");
        } else {
          // RSA signature is valid over the authenticated attributes.
          // Now verify content integrity: the messageDigest attribute was signed
          // by the private key and should equal SHA-256(byte-range content).
          // If the PDF was tampered, the recomputed digest won't match.
          if (signerInfo.messageDigest !== null && signerInfo.messageDigest !== computedDigest) {
            issues.push("digest_mismatch");
          }

          // Sanity check: byte ranges should cover the whole file minus the gap
          const [brOffset1, , brOffset2, brLength2] = byteRange;
          const expectedLength = brOffset2 + brLength2;
          if (expectedLength !== pdfBuffer.length) {
            issues.push("byte_range_length_mismatch");
          }
          if (brOffset1 !== 0) {
            issues.push("byte_range_invalid_start");
          }
        }
      } else {
        // No authenticated attributes — verify directly over content digest
        const publicKey = signerCert.publicKey as forge.pki.rsa.PublicKey;
        const rsaValid = publicKey.verify(computedDigest, signerInfo.signatureBytes);
        if (!rsaValid) {
          issues.push("signature_invalid");
        }
      }
    }
  } catch {
    issues.push("verification_error");
  }

  // Step 8: Check certificate expiry
  const now = new Date();
  if (now > signerCert.validity.notAfter) {
    issues.push("certificate_expired");
  }

  const valid = issues.length === 0;

  return {
    valid,
    signerCN,
    signedAt,
    serialNumber,
    certificateExpiry,
    issues,
  };
}

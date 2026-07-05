import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import { signPdfWithDsc } from "./dsc-signer.js";
import type { DscSignInput } from "./dsc-signer.js";
import { verifyPdfSignature } from "./pdf-verify.js";
import type { VerifyResult } from "./pdf-verify.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function generateTestP12(): { p12Buffer: Buffer; passphrase: string } {
  const passphrase = "test-verify-passphrase";

  // Generate RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create self-signed certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 86400000); // 1 day ago
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000); // 1 year from now

  const attrs = [{ name: "commonName", value: "Test Verifier Corp" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    {
      name: "keyUsage",
      digitalSignature: true,
      nonRepudiation: true,
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Create PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, passphrase, {
    algorithm: "aes256",
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  return { p12Buffer, passphrase };
}

function createMinimalPdf(): Buffer {
  const pdfContent = [
    "%PDF-1.7",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj",
    "xref",
    "0 4",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "trailer<</Size 4/Root 1 0 R>>",
    "startxref",
    "190",
    "%%EOF",
  ].join("\n");
  return Buffer.from(pdfContent, "utf-8");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("verifyPdfSignature", () => {
  let testP12: { p12Buffer: Buffer; passphrase: string };
  let signedPdfBuffer: Buffer;

  beforeAll(async () => {
    testP12 = generateTestP12();
    const pdfBuffer = createMinimalPdf();

    const dsc: DscSignInput = {
      p12Buffer: testP12.p12Buffer,
      passphrase: testP12.passphrase,
    };

    const result = await signPdfWithDsc(pdfBuffer, dsc);
    signedPdfBuffer = result.buffer;
  });

  it("verifies a freshly-signed PDF as valid", () => {
    const result: VerifyResult = verifyPdfSignature(signedPdfBuffer);

    expect(result.valid).toBe(true);
    expect(result.signerCN).toBe("Test Verifier Corp");
    expect(result.serialNumber).toBe("02");
    expect(result.certificateExpiry).toBeDefined();
    expect(result.issues).toHaveLength(0);
  });

  it("returns signer metadata from the certificate", () => {
    const result = verifyPdfSignature(signedPdfBuffer);

    expect(result.signerCN).toBe("Test Verifier Corp");
    expect(result.serialNumber).toBe("02");
    expect(result.certificateExpiry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("detects tampered PDF content as invalid", () => {
    // Create a copy and tamper with content in the first byte range
    const tampered = Buffer.from(signedPdfBuffer);

    // Modify a byte in the PDF body (within the signed byte range)
    // The first byte range starts at 0, so modifying early bytes should invalidate
    const tamperOffset = 10; // Within the original PDF content
    tampered[tamperOffset] = (tampered[tamperOffset]! + 1) % 256;

    const result = verifyPdfSignature(tampered);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    // Should report either digest_mismatch or signature_invalid
    expect(
      result.issues.includes("digest_mismatch") || result.issues.includes("signature_invalid"),
    ).toBe(true);
  });

  it("returns valid: false with 'no_signature' for unsigned PDF", () => {
    const unsignedPdf = createMinimalPdf();

    const result = verifyPdfSignature(unsignedPdf);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("no_signature");
    expect(result.signerCN).toBeUndefined();
    expect(result.serialNumber).toBeUndefined();
  });
});

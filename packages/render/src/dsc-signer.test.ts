import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import {
  signPdfWithDsc,
  validateDscCertificate,
  DscValidationError,
} from "./dsc-signer.js";
import type { DscSignInput, CertificateInfo } from "./dsc-signer.js";

// ─── Test Helpers: Generate self-signed P12 keystores ────────────────────────

interface TestP12Options {
  cn?: string;
  notBefore?: Date;
  notAfter?: Date;
  keyUsage?: boolean; // include digitalSignature key usage
}

function generateTestP12(opts: TestP12Options = {}): { p12Buffer: Buffer; passphrase: string } {
  const passphrase = "test-passphrase";
  const cn = opts.cn ?? "Test Signer";
  const notBefore = opts.notBefore ?? new Date(Date.now() - 86400000); // 1 day ago
  const notAfter = opts.notAfter ?? new Date(Date.now() + 365 * 86400000); // 1 year from now

  // Generate RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create self-signed certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  const extensions: Array<{ name: string; [key: string]: unknown }> = [];
  if (opts.keyUsage !== false) {
    extensions.push({
      name: "keyUsage",
      digitalSignature: true,
      nonRepudiation: true,
    });
  }
  cert.setExtensions(extensions);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Create PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, passphrase, {
    algorithm: "aes256",
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  return { p12Buffer, passphrase };
}

// A minimal valid PDF buffer for testing
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

describe("validateDscCertificate", () => {
  let validP12: { p12Buffer: Buffer; passphrase: string };

  beforeAll(() => {
    validP12 = generateTestP12({ cn: "Valid Signer Corp" });
  });

  it("returns certificate info for a valid P12", () => {
    const info: CertificateInfo = validateDscCertificate(validP12.p12Buffer, validP12.passphrase);

    expect(info.subjectCN).toBe("Valid Signer Corp");
    expect(info.serialNumber).toBe("01");
    expect(info.notBefore).toBeInstanceOf(Date);
    expect(info.notAfter).toBeInstanceOf(Date);
    expect(info.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(info.keyUsage).toContain("digitalSignature");
  });

  it("throws DscValidationError for expired certificate", () => {
    const expired = generateTestP12({
      cn: "Expired Cert",
      notBefore: new Date("2020-01-01"),
      notAfter: new Date("2021-01-01"),
    });

    expect(() => validateDscCertificate(expired.p12Buffer, expired.passphrase)).toThrow(
      DscValidationError,
    );

    try {
      validateDscCertificate(expired.p12Buffer, expired.passphrase);
    } catch (err) {
      const dscErr = err as DscValidationError;
      expect(dscErr.code).toBe("DSC_CERTIFICATE_EXPIRED");
      expect(dscErr.message).toContain("expired");
    }
  });

  it("throws DscValidationError for wrong passphrase", () => {
    expect(() => validateDscCertificate(validP12.p12Buffer, "wrong-passphrase")).toThrow(
      DscValidationError,
    );

    try {
      validateDscCertificate(validP12.p12Buffer, "wrong-passphrase");
    } catch (err) {
      const dscErr = err as DscValidationError;
      expect(dscErr.code).toBe("DSC_PASSPHRASE_INCORRECT");
    }
  });

  it("throws DscValidationError when certificate lacks digitalSignature key usage", () => {
    const noKeyUsage = generateTestP12({ cn: "No Key Usage", keyUsage: false });

    expect(() => validateDscCertificate(noKeyUsage.p12Buffer, noKeyUsage.passphrase)).toThrow(
      DscValidationError,
    );

    try {
      validateDscCertificate(noKeyUsage.p12Buffer, noKeyUsage.passphrase);
    } catch (err) {
      const dscErr = err as DscValidationError;
      expect(dscErr.code).toBe("DSC_CERTIFICATE_INVALID");
      expect(dscErr.message).toContain("digitalSignature");
    }
  });
});

describe("signPdfWithDsc", () => {
  let validP12: { p12Buffer: Buffer; passphrase: string };
  let pdfBuffer: Buffer;

  beforeAll(() => {
    validP12 = generateTestP12({ cn: "Form16 DDO Signer" });
    pdfBuffer = createMinimalPdf();
  });

  it("signs a PDF and returns valid SignedPdfResult", async () => {
    const dsc: DscSignInput = {
      p12Buffer: validP12.p12Buffer,
      passphrase: validP12.passphrase,
    };

    const result = await signPdfWithDsc(pdfBuffer, dsc);

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(pdfBuffer.length);
    expect(result.signerCN).toBe("Form16 DDO Signer");
    expect(result.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.serialNumber).toBe("01");
    expect(result.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("output contains PDF signature dictionary markers", async () => {
    const dsc: DscSignInput = {
      p12Buffer: validP12.p12Buffer,
      passphrase: validP12.passphrase,
    };

    const result = await signPdfWithDsc(pdfBuffer, dsc);
    const pdfStr = result.buffer.toString("binary");

    // Should contain signature dictionary markers
    expect(pdfStr).toContain("/SubFilter /adbe.pkcs7.detached");
    expect(pdfStr).toContain("/Filter /Adobe.PPKLite");
    expect(pdfStr).toContain("/ByteRange");
    expect(pdfStr).toContain("/Contents <");
  });

  it("byte range covers correct regions (sum = file length - placeholder)", async () => {
    const dsc: DscSignInput = {
      p12Buffer: validP12.p12Buffer,
      passphrase: validP12.passphrase,
    };

    const result = await signPdfWithDsc(pdfBuffer, dsc);
    const pdfStr = result.buffer.toString("binary");

    // Extract ByteRange from the signed PDF
    const byteRangeMatch = pdfStr.match(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/);
    expect(byteRangeMatch).not.toBeNull();

    if (byteRangeMatch) {
      const offset1 = parseInt(byteRangeMatch[1]!, 10);
      const length1 = parseInt(byteRangeMatch[2]!, 10);
      const offset2 = parseInt(byteRangeMatch[3]!, 10);
      const length2 = parseInt(byteRangeMatch[4]!, 10);

      // offset1 should be 0 (start of file)
      expect(offset1).toBe(0);

      // The two ranges + the contents placeholder should equal total file length
      // Range 1: [0, length1]
      // Placeholder: [length1, offset2]
      // Range 2: [offset2, offset2 + length2]
      expect(length1 + (offset2 - length1) + length2).toBe(result.buffer.length);

      // offset2 should be > length1 (placeholder is between them)
      expect(offset2).toBeGreaterThan(length1);
    }
  });

  it("throws DscValidationError for expired certificate", async () => {
    const expired = generateTestP12({
      cn: "Expired DDO",
      notBefore: new Date("2020-01-01"),
      notAfter: new Date("2021-01-01"),
    });

    const dsc: DscSignInput = {
      p12Buffer: expired.p12Buffer,
      passphrase: expired.passphrase,
    };

    await expect(signPdfWithDsc(pdfBuffer, dsc)).rejects.toThrow(DscValidationError);
    await expect(signPdfWithDsc(pdfBuffer, dsc)).rejects.toMatchObject({
      code: "DSC_CERTIFICATE_EXPIRED",
    });
  });

  it("throws DscValidationError for wrong passphrase", async () => {
    const dsc: DscSignInput = {
      p12Buffer: validP12.p12Buffer,
      passphrase: "wrong-passphrase",
    };

    await expect(signPdfWithDsc(pdfBuffer, dsc)).rejects.toThrow(DscValidationError);
    await expect(signPdfWithDsc(pdfBuffer, dsc)).rejects.toMatchObject({
      code: "DSC_PASSPHRASE_INCORRECT",
    });
  });

  it("signature annotation text contains signer name", async () => {
    const dsc: DscSignInput = {
      p12Buffer: validP12.p12Buffer,
      passphrase: validP12.passphrase,
    };

    const result = await signPdfWithDsc(pdfBuffer, dsc);
    const pdfStr = result.buffer.toString("binary");

    expect(pdfStr).toContain("Form16 DDO Signer");
    expect(pdfStr).toContain("Digitally signed by Form16 DDO Signer");
  });
});

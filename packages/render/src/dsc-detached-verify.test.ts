/**
 * Tests for the standalone detached PKCS#7/CMS verifier (verifyDetachedPkcs7)
 * and its signing companion (signDetachedPkcs7). Uses an ad-hoc self-signed
 * RSA cert so the whole sign → verify loop runs with REAL node-forge crypto —
 * no fixtures, no network, no external CA.
 */
import { describe, it, expect } from "vitest";
import forge from "node-forge";
import { verifyDetachedPkcs7, signDetachedPkcs7 } from "./dsc-detached-verify.js";

interface TestCert {
  privateKeyPem: string;
  certificatePem: string;
  /** The self-signed cert, usable as its own trust root. */
  trustPem: string;
}

function makeCert(opts: { cn?: string; notBefore?: Date; notAfter?: Date; digitalSignature?: boolean } = {}): TestCert {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + Math.floor(Math.random() * 1e8).toString(16);
  const now = new Date();
  cert.validity.notBefore = opts.notBefore ?? new Date(now.getTime() - 24 * 3600 * 1000);
  cert.validity.notAfter = opts.notAfter ?? new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const attrs = [{ name: "commonName", value: opts.cn ?? "Hon'ble Judge Test" }, { name: "countryName", value: "IN" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      digitalSignature: opts.digitalSignature ?? true,
      nonRepudiation: true,
      keyCertSign: true,
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem,
    trustPem: certificatePem,
  };
}

const CONTENT = "court-order:abc\ncase:xyz\ntype:final\ndate:2026-07-11\ntext:It is so ordered.";

describe("verifyDetachedPkcs7", () => {
  it("verifies a genuine detached signature over the exact content", () => {
    const c = makeCert();
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT });
    expect(r.structureValid).toBe(true);
    expect(r.signatureChecked).toBe(true);
    expect(r.signatureValid).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.signerCN).toBe("Hon'ble Judge Test");
    expect(r.keyUsage).toContain("digitalSignature");
  });

  it("rejects a signature when the content was tampered (digest_mismatch)", () => {
    const c = makeCert();
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT + " (altered)" });
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("digest_mismatch");
  });

  it("rejects a mis-pasted / non-PKCS7 blob (malformed/invalid)", () => {
    const r = verifyDetachedPkcs7({ signature: "this is just a password not a signature", content: CONTENT });
    expect(r.ok).toBe(false);
    expect(r.structureValid).toBe(false);
    expect(r.issues.some((i) => i === "malformed_base64" || i === "invalid_pkcs7")).toBe(true);
  });

  it("flags an expired signer certificate", () => {
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const c = makeCert({ notBefore: new Date(Date.now() - 400 * 24 * 3600 * 1000), notAfter: past });
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT });
    expect(r.issues).toContain("certificate_expired");
    expect(r.ok).toBe(false);
  });

  it("fails closed on chain trust when no trust store is configured", () => {
    const c = makeCert();
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT });
    expect(r.chainTrusted).toBe(false);
    expect(r.issues).toContain("trust_store_not_configured");
    // but local verification still succeeds
    expect(r.ok).toBe(true);
  });

  it("reports chainTrusted when the signer chains to a configured trust store", () => {
    const c = makeCert();
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT, trustStorePem: c.trustPem });
    expect(r.chainTrusted).toBe(true);
    expect(r.issues).not.toContain("trust_store_not_configured");
    expect(r.ok).toBe(true);
  });

  it("does not report chain trust for an unrelated trust store", () => {
    const signer = makeCert();
    const stranger = makeCert({ cn: "Unrelated Root" });
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: signer.privateKeyPem, certificatePem: signer.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig, content: CONTENT, trustStorePem: stranger.trustPem });
    expect(r.chainTrusted).toBe(false);
    expect(r.issues).toContain("chain_untrusted");
  });

  it("runs structural checks without content (signatureChecked false)", () => {
    const c = makeCert();
    const sig = signDetachedPkcs7({ content: CONTENT, privateKeyPem: c.privateKeyPem, certificatePem: c.certificatePem });
    const r = verifyDetachedPkcs7({ signature: sig });
    expect(r.structureValid).toBe(true);
    expect(r.signatureChecked).toBe(false);
    expect(r.signerCN).toBe("Hon'ble Judge Test");
  });
});

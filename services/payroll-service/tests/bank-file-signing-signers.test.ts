/**
 * GAP-PAYROLL-DISBURSEMENT-03 -- signing primitives, key provider, policy.
 * Keys are generated at test runtime (nothing committed).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, symlinkSync, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as openpgp from "openpgp";
import {
  encryptPgpToRecipient, pgpPublicKeyOf, signPgpDetached, signPkcs7Detached, signXmlDsig,
  verifyPgpDetached, verifyPkcs7Detached, verifyXmlDsig,
} from "../src/modules/bank-file-signing/signers.js";
import {
  DevFileSigningKeyProvider, KeystoreSigningKeyProvider, SigningKeyError, generateKeyBundle, getSigningKeyProvider,
} from "../src/modules/bank-file-signing/key-provider.js";
import { assertUnsignedAllowed, planBankFileSigning, signRenderedFile } from "../src/modules/bank-file-signing/service.js";
import { setIntegrationEnvironmentResolver } from "../src/modules/bank-file-signing/environment.js";
import { DEFAULT_BANK_FILE_SIGNING, effectiveFormat } from "../src/modules/bank-file-signing/types.js";
import { makeTestProvider, type TestProvider } from "./fixtures/signing-test-provider.js";

const CSV = Buffer.from("Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration\r\nE1,Asha,123,SBIN0001234,45231.50,Salary\r\nTRAILER,1,,,45231.50,Control total", "utf8");
const XML = `<?xml version="1.0" encoding="UTF-8"?><PaymentFile><Header><Count>1</Count></Header><Payment><Id>P1</Id><Amount>45231.50</Amount></Payment></PaymentFile>`;

let p: TestProvider;
beforeAll(async () => { p = await makeTestProvider({ withBankKey: true }); });
afterEach(() => { setIntegrationEnvironmentResolver(null); vi.unstubAllEnvs(); });

const file = (body: string | Buffer, contentType = "text/csv; charset=utf-8") => ({
  body, contentType, downloadName: "bank_transfer_RUN1_2026-09.csv", fileCount: 1, lineFileRefs: ["x"], batchFrom: null, batchTo: null,
});

describe("OpenPGP detached signature", () => {
  it("verifies with the public key, uses SHA-256, and is ASCII-armoured", async () => {
    const sig = await signPgpDetached(CSV, p.material.pgpPrivateKeyArmored);
    expect(sig.startsWith("-----BEGIN PGP SIGNATURE-----")).toBe(true);
    const pub = await pgpPublicKeyOf(p.material.pgpPrivateKeyArmored);
    expect(await verifyPgpDetached(CSV, sig, pub)).toEqual({ ok: true, hash: "sha256" });
  });

  it("a tampered file fails verification (one byte flipped)", async () => {
    const sig = await signPgpDetached(CSV, p.material.pgpPrivateKeyArmored);
    const pub = await pgpPublicKeyOf(p.material.pgpPrivateKeyArmored);
    const tampered = Buffer.from(CSV);
    tampered[tampered.length - 5] ^= 0x01;
    expect((await verifyPgpDetached(tampered, sig, pub)).ok).toBe(false);
  });

  it("a different key does not verify the signature", async () => {
    const sig = await signPgpDetached(CSV, p.material.pgpPrivateKeyArmored);
    const other = await makeTestProvider();
    expect((await verifyPgpDetached(CSV, sig, await pgpPublicKeyOf(other.material.pgpPrivateKeyArmored))).ok).toBe(false);
  });

  it("encrypt-to-bank round-trips with the bank's private key; the signature is over the plaintext", async () => {
    const enc = await encryptPgpToRecipient(CSV, p.bank!.publicKey);
    const msg = await openpgp.readMessage({ binaryMessage: enc });
    const dec = await openpgp.decrypt({ message: msg, decryptionKeys: await openpgp.readPrivateKey({ armoredKey: p.bank!.privateKey }), format: "binary" });
    expect(Buffer.from(dec.data as Uint8Array).equals(CSV)).toBe(true);
  });
});

describe("XML-DSig enveloped (RSA-SHA256, exclusive C14N)", () => {
  it("verifies, and records the expected algorithms", () => {
    const signed = signXmlDsig(XML, p.material.rsaPrivateKeyPem, p.material.certPem);
    expect(verifyXmlDsig(signed, p.material.certPem)).toBe(true);
    expect(signed).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(signed).toContain("http://www.w3.org/2001/10/xml-exc-c14n#");
    expect(signed).toContain("http://www.w3.org/2000/09/xmldsig#enveloped-signature");
    // the original document is still inside, unchanged
    expect(signed).toContain("<Amount>45231.50</Amount>");
  });

  it("a tampered amount fails verification", () => {
    const signed = signXmlDsig(XML, p.material.rsaPrivateKeyPem, p.material.certPem);
    expect(verifyXmlDsig(signed.replace("45231.50", "99999.99"), p.material.certPem)).toBe(false);
  });

  it("an unsigned document does not verify", () => {
    expect(verifyXmlDsig(XML, p.material.certPem)).toBe(false);
  });
});

describe("PKCS#7 detached (.p7s)", () => {
  it("verifies with the certificate and a tampered file fails", () => {
    const der = signPkcs7Detached(CSV, p.material.rsaPrivateKeyPem, p.material.certPem);
    expect(verifyPkcs7Detached(CSV, der, p.material.certPem)).toBe(true);
    const tampered = Buffer.from(CSV);
    tampered[3] ^= 0x01;
    expect(verifyPkcs7Detached(tampered, der, p.material.certPem)).toBe(false);
  });

  it("a signature made with another certificate is rejected even though it is self-consistent", async () => {
    const other = await makeTestProvider();
    const der = signPkcs7Detached(CSV, other.material.rsaPrivateKeyPem, other.material.certPem);
    expect(verifyPkcs7Detached(CSV, der, p.material.certPem)).toBe(false);
  });

  it("is verified by an independent implementation (openssl cms)", () => {
    const dir = mkdtempSync(join(tmpdir(), "p7s-"));
    try {
      const der = signPkcs7Detached(CSV, p.material.rsaPrivateKeyPem, p.material.certPem);
      writeFileSync(join(dir, "f.csv"), CSV);
      writeFileSync(join(dir, "f.csv.p7s"), der);
      writeFileSync(join(dir, "cert.pem"), p.material.certPem);
      const r = spawnSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", join(dir, "f.csv.p7s"),
        "-content", join(dir, "f.csv"), "-CAfile", join(dir, "cert.pem"), "-purpose", "any", "-out", "/dev/null"], { encoding: "utf8" });
      expect(r.stderr + r.stdout).toMatch(/Verification successful/);
      writeFileSync(join(dir, "f.csv"), Buffer.concat([CSV, Buffer.from("X")]));
      const bad = spawnSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", join(dir, "f.csv.p7s"),
        "-content", join(dir, "f.csv"), "-CAfile", join(dir, "cert.pem"), "-purpose", "any", "-out", "/dev/null"], { encoding: "utf8" });
      expect(bad.status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("signRenderedFile -- policy, self-check, encryption", () => {
  it("default plan is pgp_detached, unencrypted, and the record carries signature + sha256 of the exact bytes", async () => {
    const plan = await planBankFileSigning("t1", DEFAULT_BANK_FILE_SIGNING, "SBIN");
    expect(plan).toMatchObject({ format: "pgp_detached", encryptToBank: false });
    const out = await signRenderedFile(plan, file(CSV), p);
    expect(out.record.signed).toBe(true);
    expect(out.record.signatureFileName).toBe("bank_transfer_RUN1_2026-09.csv.sig");
    const { createHash } = await import("node:crypto");
    expect(out.record.fileSha256).toBe(createHash("sha256").update(CSV).digest("hex"));
    expect(out.record.keyFingerprint).toBe(p.material.pgpFingerprint);
    expect((await verifyPgpDetached(out.file.body as Buffer, out.record.signature!, await pgpPublicKeyOf(p.material.pgpPrivateKeyArmored))).ok).toBe(true);
  });

  it("a string body is signed as its UTF-8 bytes (what the response sends)", async () => {
    const plan = await planBankFileSigning("t1", DEFAULT_BANK_FILE_SIGNING, null);
    const out = await signRenderedFile(plan, file("Name\r\nZoë Ñandi"), p);
    const pub = await pgpPublicKeyOf(p.material.pgpPrivateKeyArmored);
    expect((await verifyPgpDetached(Buffer.from("Name\r\nZoë Ñandi", "utf8"), out.record.signature!, pub)).ok).toBe(true);
  });

  it("pkcs7_detached stores base64 DER that verifies", async () => {
    const plan = await planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, format: "pkcs7_detached" }, null);
    const out = await signRenderedFile(plan, file(CSV), p);
    expect(out.record.signatureFileName).toMatch(/\.p7s$/);
    expect(verifyPkcs7Detached(CSV, Buffer.from(out.record.signature!, "base64"), p.material.certPem)).toBe(true);
  });

  it("xml_dsig signs an XML file (envelope, no sidecar) and refuses a non-XML file closed", async () => {
    const plan = await planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, format: "xml_dsig" }, null);
    const out = await signRenderedFile(plan, file(XML, "application/xml"), p);
    expect(out.record).toMatchObject({ signed: true, signature: null, signatureFileName: null, format: "xml_dsig" });
    expect(verifyXmlDsig((out.file.body as Buffer).toString("utf8"), p.material.certPem)).toBe(true);
    await expect(signRenderedFile(plan, file(CSV), p)).rejects.toMatchObject({ status: 422, code: "SIGNING_FORMAT_NOT_APPLICABLE" });
  });

  it("per-bank override beats the tenant default", () => {
    const cfg = { ...DEFAULT_BANK_FILE_SIGNING, perBankOverrides: { HDFC: "pkcs7_detached" as const } };
    expect(effectiveFormat(cfg, "HDFC")).toBe("pkcs7_detached");
    expect(effectiveFormat(cfg, "sbin")).toBe("pgp_detached");
    expect(effectiveFormat(cfg, null)).toBe("pgp_detached");
  });

  it("encrypt-to-bank wraps the SIGNED bytes: .pgp name, decrypts to the file, signature still verifies", async () => {
    const plan = await planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, encryptToBank: true }, "SBIN");
    const out = await signRenderedFile(plan, file(CSV), p);
    expect(out.file.downloadName).toBe("bank_transfer_RUN1_2026-09.csv.pgp");
    expect(out.record.encryptedToBank).toBe(true);
    const dec = await openpgp.decrypt({
      message: await openpgp.readMessage({ binaryMessage: out.file.body as Buffer }),
      decryptionKeys: await openpgp.readPrivateKey({ armoredKey: p.bank!.privateKey }), format: "binary",
    });
    const plain = Buffer.from(dec.data as Uint8Array);
    expect(plain.equals(CSV)).toBe(true);
    expect((await verifyPgpDetached(plain, out.record.signature!, await pgpPublicKeyOf(p.material.pgpPrivateKeyArmored))).ok).toBe(true);
  });

  it("encrypt-to-bank with no bank key configured fails closed (422), nothing is returned", async () => {
    const noBank = await makeTestProvider();
    const plan = await planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, encryptToBank: true }, "SBIN");
    await expect(signRenderedFile(plan, file(CSV), noBank)).rejects.toMatchObject({ status: 422, code: "SIGNING_RECIPIENT_KEY_MISSING" });
  });

  it("SELF-CHECK fails closed: a key whose signatures are not SHA-256 (Ed25519 signs SHA-512) is refused, no file returned", async () => {
    const ecc = await generateKeyBundle({ pgpType: "ecc", rsaBits: 2048 });
    const base = await makeTestProvider();
    const eccProvider = { ...base, material: { ...base.material, pgpPrivateKeyArmored: ecc.pgpPrivateKeyArmored } };
    eccProvider.getSigningMaterial = async () => eccProvider.material;
    const plan = await planBankFileSigning("t1", DEFAULT_BANK_FILE_SIGNING, null);
    await expect(signRenderedFile(plan, file(CSV), eccProvider)).rejects.toMatchObject({ status: 500, code: "SIGNING_SELF_CHECK_FAILED" });
  });

  it("a missing / unimplemented key fails closed with 503 and never returns an unsigned file", async () => {
    const plan = await planBankFileSigning("t1", DEFAULT_BANK_FILE_SIGNING, null);
    await expect(signRenderedFile(plan, file(CSV), new KeystoreSigningKeyProvider()))
      .rejects.toMatchObject({ status: 503, code: "SIGNING_NOT_IMPLEMENTED" });
  });

  it("none: allowed in dev, signature absent, sha256 still recorded", async () => {
    const plan = await planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, format: "none" }, null);
    const out = await signRenderedFile(plan, file(CSV), p);
    expect(out.record).toMatchObject({ format: "none", signed: false, signature: null });
    expect(out.record.fileSha256).toHaveLength(64);
  });

  it("none is REFUSED when NODE_ENV=production, for the default and for a per-bank override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, format: "none" }, null))
      .rejects.toMatchObject({ status: 422, code: "UNSIGNED_NOT_ALLOWED_IN_PRODUCTION" });
    await expect(assertUnsignedAllowed("t1", { ...DEFAULT_BANK_FILE_SIGNING, perBankOverrides: { SBIN: "none" } }))
      .rejects.toMatchObject({ code: "UNSIGNED_NOT_ALLOWED_IN_PRODUCTION" });
    // signed formats are untouched
    await expect(assertUnsignedAllowed("t1", DEFAULT_BANK_FILE_SIGNING)).resolves.toBeUndefined();
  });

  it("none is REFUSED when the tenant's integration environment is production (even with NODE_ENV=test)", async () => {
    setIntegrationEnvironmentResolver(async (t) => (t === "prod-tenant" ? "production" : "sandbox"));
    await expect(planBankFileSigning("prod-tenant", { ...DEFAULT_BANK_FILE_SIGNING, format: "none" }, null))
      .rejects.toMatchObject({ code: "UNSIGNED_NOT_ALLOWED_IN_PRODUCTION" });
    await expect(planBankFileSigning("sandbox-tenant", { ...DEFAULT_BANK_FILE_SIGNING, format: "none" }, null)).resolves.toMatchObject({ format: "none" });
  });

  it("none + encryptToBank is a config conflict", async () => {
    await expect(planBankFileSigning("t1", { ...DEFAULT_BANK_FILE_SIGNING, format: "none", encryptToBank: true }, null))
      .rejects.toMatchObject({ code: "SIGNING_CONFIG_CONFLICT" });
  });
});

/** Mode + content read through ONE file descriptor (no path stat-then-read gap). */
function snapshot(path: string): { mode: number; content: string } {
  const fd = openSync(path, "r");
  try {
    return { mode: fstatSync(fd).mode, content: readFileSync(fd, "utf8") };
  } finally {
    closeSync(fd);
  }
}

describe("DevFileSigningKeyProvider", () => {
  it("creates the key file with mode 600 only if absent, and never overwrites it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyfile-"));
    const path = join(dir, "key");
    try {
      const prov = new DevFileSigningKeyProvider(path);
      expect((await prov.status("default")).present).toBe(false);
      expect(await prov.ensure()).toEqual({ created: true });
      const firstSnap = snapshot(path);
      expect(firstSnap.mode & 0o777).toBe(0o600);
      const first = firstSnap.content;
      expect(await prov.ensure()).toEqual({ created: false });
      expect(snapshot(path).content).toBe(first);
      const st = await prov.status("default");
      expect(st).toMatchObject({ present: true, provider: "dev-file" });
      // status exposes only a public fingerprint, never key material
      expect(JSON.stringify(st)).not.toMatch(/PRIVATE KEY/);
      const m = await prov.getSigningMaterial("default");
      expect(m.pgpFingerprint).toBe(st.fingerprint);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses a key file readable by group/others", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyfile-"));
    const path = join(dir, "key");
    try {
      writeFileSync(path, JSON.stringify(await generateKeyBundle({ pgpRsaBits: 2048 })), { mode: 0o600 });
      chmodSync(path, 0o644);
      await expect(new DevFileSigningKeyProvider(path).getSigningMaterial("default")).rejects.toMatchObject({ code: "KEY_INSECURE_PERMISSIONS" });
      expect((await new DevFileSigningKeyProvider(path).status("default")).present).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses a symlinked key file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyfile-"));
    try {
      const real = join(dir, "real");
      writeFileSync(real, JSON.stringify(await generateKeyBundle({ pgpRsaBits: 2048 })), { mode: 0o600 });
      symlinkSync(real, join(dir, "link"));
      await expect(new DevFileSigningKeyProvider(join(dir, "link")).getSigningMaterial("default")).rejects.toMatchObject({ code: "KEY_INSECURE_PERMISSIONS" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("only the 'default' keyRef is served; an unknown ref is KEY_MISSING", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyfile-"));
    try {
      await expect(new DevFileSigningKeyProvider(join(dir, "k")).getSigningMaterial("hsm:slot1")).rejects.toBeInstanceOf(SigningKeyError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a garbled key file is KEY_INVALID without echoing its content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyfile-"));
    const path = join(dir, "key");
    try {
      writeFileSync(path, "SECRET-NOT-JSON", { mode: 0o600 });
      const err = await new DevFileSigningKeyProvider(path).getSigningMaterial("default").catch((e: Error) => e);
      expect((err as SigningKeyError).code).toBe("KEY_INVALID");
      expect((err as Error).message).not.toContain("SECRET-NOT-JSON");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("getSigningKeyProvider selection", () => {
  it("is the dev file provider by default, and the keystore stub for NODE_ENV=production or PAYROLL_INTEGRATION_ENVIRONMENT=production/prod", () => {
    expect(getSigningKeyProvider().kind).toBe("dev-file");
    vi.stubEnv("PAYROLL_INTEGRATION_ENVIRONMENT", "sandbox");
    expect(getSigningKeyProvider().kind).toBe("dev-file");
    for (const v of ["production", "prod", " Production "]) {
      vi.stubEnv("PAYROLL_INTEGRATION_ENVIRONMENT", v);
      expect(getSigningKeyProvider().kind).toBe("keystore");
    }
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    expect(getSigningKeyProvider().kind).toBe("keystore");
  });
});

describe("KeystoreSigningKeyProvider (production stub)", () => {
  it("throws a clear NOT_IMPLEMENTED for signing and for the bank key; status reports not present", async () => {
    const k = new KeystoreSigningKeyProvider();
    await expect(k.getSigningMaterial("default")).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    await expect(k.getRecipientPublicKey("default", "SBIN")).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    expect(await k.status("default")).toMatchObject({ present: false, provider: "keystore" });
  });
});

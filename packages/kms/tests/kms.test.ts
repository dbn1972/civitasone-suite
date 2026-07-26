import { describe, it, expect } from "vitest";
import {
  LocalKmsProvider, AwsKmsProvider, KmsNotConfiguredError, kmsFromEnv,
  CertificateRegistry, renewalStatus, daysUntilExpiry, isExpired, dueForRenewal,
} from "../src/index.js";

const MK = LocalKmsProvider.generateMasterKey();

describe("LocalKmsProvider (envelope encryption)", () => {
  it("round-trips plaintext", async () => {
    const kms = new LocalKmsProvider(MK);
    const env = await kms.encrypt("aadhaar:1234-5678-9012");
    expect(env.ciphertext).not.toContain("aadhaar");
    const out = await kms.decrypt(env);
    expect(out.toString("utf8")).toBe("aadhaar:1234-5678-9012");
  });

  it("produces distinct ciphertext for the same plaintext (fresh data key + IV)", async () => {
    const kms = new LocalKmsProvider(MK);
    const a = await kms.encrypt("secret");
    const b = await kms.encrypt("secret");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.encryptedDataKey).not.toBe(b.encryptedDataKey);
    expect((await kms.decrypt(a)).toString()).toBe("secret");
    expect((await kms.decrypt(b)).toString()).toBe("secret");
  });

  it("detects tampering (GCM auth failure)", async () => {
    const kms = new LocalKmsProvider(MK);
    const env = await kms.encrypt("integrity");
    const tampered = { ...env, ciphertext: Buffer.from("00".repeat(16), "hex").toString("base64") };
    await expect(kms.decrypt(tampered)).rejects.toThrow();
  });

  it("generateDataKey returns a 32-byte plaintext key + wrapped key", async () => {
    const kms = new LocalKmsProvider(MK);
    const dk = await kms.generateDataKey();
    expect(dk.plaintextKey.length).toBe(32);
    expect(dk.encryptedDataKey.length).toBeGreaterThan(0);
  });

  it("rotates and still decrypts old-key ciphertext", async () => {
    const kms = new LocalKmsProvider(MK);
    const before = await kms.encrypt("pre-rotation");
    const { keyId } = await kms.rotate();
    expect(keyId).toMatch(/^local-/);
    const after = await kms.encrypt("post-rotation");
    expect(after.keyId).toBe(keyId);
    expect((await kms.decrypt(before)).toString()).toBe("pre-rotation"); // old version retained
    expect((await kms.decrypt(after)).toString()).toBe("post-rotation");
  });

  it("rejects a wrong-size master key", () => {
    expect(() => new LocalKmsProvider(Buffer.alloc(16))).toThrow(KmsNotConfiguredError);
    expect(() => new LocalKmsProvider("")).toThrow();
  });
});

describe("AwsKmsProvider (honest not-configured stub)", () => {
  it("reports not configured without env", () => {
    expect(new AwsKmsProvider(undefined).isConfigured()).toBe(false);
  });
  it("throws a clear error rather than faking crypto", async () => {
    const aws = new AwsKmsProvider("arn:aws:kms:ap-south-1:0:key/abc");
    await expect(aws.encrypt("x")).rejects.toBeInstanceOf(KmsNotConfiguredError);
    await expect(aws.rotate()).rejects.toThrow(/not integrated/);
  });
});

describe("kmsFromEnv", () => {
  it("returns Local by default", () => {
    expect(kmsFromEnv({ KMS_MASTER_KEY: MK } as NodeJS.ProcessEnv).name).toBe("local");
  });
  it("returns AWS when requested", () => {
    expect(kmsFromEnv({ KMS_PROVIDER: "aws" } as NodeJS.ProcessEnv).name).toBe("aws-kms");
  });
});

describe("certificate lifecycle", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const cert = (days: number) => ({ id: `c${days}`, commonName: "civitas.gov.in", notBefore: new Date("2026-01-01"), notAfter: new Date(now.getTime() + days * 86_400_000) });

  it("computes days + status thresholds", () => {
    expect(daysUntilExpiry(cert(45), now)).toBe(45);
    expect(renewalStatus(cert(45), {}, now)).toBe("ok");
    expect(renewalStatus(cert(20), {}, now)).toBe("renew_soon");
    expect(renewalStatus(cert(3), {}, now)).toBe("expiring");
    expect(renewalStatus(cert(-1), {}, now)).toBe("expired");
    expect(isExpired(cert(-1), now)).toBe(true);
  });

  it("dueForRenewal filters healthy certs out", () => {
    const due = dueForRenewal([cert(60), cert(10), cert(-2)], {}, now);
    expect(due.map((c) => c.id)).toEqual(["c10", "c-2"]);
  });

  it("registry tracks certs and reminders with an injected clock", () => {
    const reg = new CertificateRegistry({ renewSoonDays: 30, expiringDays: 7 }, () => now);
    reg.add(cert(60)); reg.add(cert(5));
    expect(reg.list().length).toBe(2);
    expect(reg.statusOf("c5")).toBe("expiring");
    const reminders = reg.reminders();
    expect(reminders.length).toBe(1);
    expect(reminders[0].cert.id).toBe("c5");
    expect(reminders[0].daysLeft).toBe(5);
  });

  it("rejects an inverted validity window and unknown ids", () => {
    const reg = new CertificateRegistry();
    expect(() => reg.add({ id: "bad", commonName: "x", notBefore: new Date("2026-02-01"), notAfter: new Date("2026-01-01") })).toThrow();
    expect(() => reg.statusOf("missing")).toThrow();
  });
});

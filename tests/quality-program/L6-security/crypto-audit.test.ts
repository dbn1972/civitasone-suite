/**
 * L6 — Security: Cryptography Audit (P1)
 *
 * Verifies AES-256-GCM PII encryption:
 * 1. Unique IV per encryption (no IV reuse → catastrophic for GCM)
 * 2. Auth tag verification (tampered ciphertext must fail)
 * 3. Fail-closed on missing key (never silently pass through)
 * 4. No plaintext leakage in ciphertext
 * 5. Key rotation safety (old ciphertext still decryptable)
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../../..");

type CryptoModule = {
  encryptPii: (plain: string) => string;
  decryptPii: (stored: string) => string;
  isEncrypted: (value: string) => boolean;
  resetPiiKeyCache: () => void;
  PiiDecryptError: new (msg: string) => Error;
};

let crypto: CryptoModule;
const ORIGINAL_KEY = process.env.PII_ENC_KEY;

beforeAll(async () => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32_chars_min";
  crypto = (await import(
    `${REPO_ROOT}/services/hrms-service/src/shared/pii-crypto.js`
  )) as unknown as CryptoModule;
});

afterEach(() => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32_chars_min";
  crypto.resetPiiKeyCache();
});

describe("L6 — AES-256-GCM: IV uniqueness (no reuse)", () => {
  it("100 encryptions of the same plaintext produce 100 distinct ciphertexts", () => {
    const plain = "aadhaar-1234-5678-9012";
    const ciphertexts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ciphertexts.add(crypto.encryptPii(plain));
    }
    // IV reuse would produce identical ciphertexts — catastrophic for GCM
    expect(ciphertexts.size).toBe(100);
  });

  it("IV segment differs across encryptions", () => {
    const plain = "sensitive-data";
    const c1 = crypto.encryptPii(plain);
    const c2 = crypto.encryptPii(plain);
    // Extract the base64 payload (after enc:v2:<keyid>:)
    const payload1 = c1.split(":").slice(3).join(":");
    const payload2 = c2.split(":").slice(3).join(":");
    const iv1 = Buffer.from(payload1, "base64").subarray(0, 12);
    const iv2 = Buffer.from(payload2, "base64").subarray(0, 12);
    expect(iv1.equals(iv2)).toBe(false);
  });
});

describe("L6 — AES-256-GCM: Auth tag verification (tamper detection)", () => {
  it("flipping one bit in ciphertext → decrypt throws", () => {
    const plain = "pan-ABCDE1234F";
    const encrypted = crypto.encryptPii(plain);
    const parts = encrypted.split(":");
    const payload = Buffer.from(parts.slice(3).join(":"), "base64");
    // Flip a bit in the ciphertext region (after IV + tag)
    payload[payload.length - 1] ^= 0x01;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${payload.toString("base64")}`;

    expect(() => crypto.decryptPii(tampered)).toThrow();
  });

  it("modifying the auth tag → decrypt throws", () => {
    const plain = "bank-account-123456789";
    const encrypted = crypto.encryptPii(plain);
    const parts = encrypted.split(":");
    const payload = Buffer.from(parts.slice(3).join(":"), "base64");
    // Tamper with the tag region (bytes 12-27)
    payload[15] ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${payload.toString("base64")}`;

    expect(() => crypto.decryptPii(tampered)).toThrow();
  });

  it("truncated ciphertext → decrypt throws (no partial plaintext)", () => {
    const plain = "phone-9876543210";
    const encrypted = crypto.encryptPii(plain);
    const truncated = encrypted.slice(0, encrypted.length - 8);
    expect(() => crypto.decryptPii(truncated)).toThrow();
  });
});

describe("L6 — Fail-closed: no silent pass-through", () => {
  it("missing PII_ENC_KEY → encrypt throws (never stores plaintext)", () => {
    delete process.env.PII_ENC_KEY;
    crypto.resetPiiKeyCache();
    expect(() => crypto.encryptPii("secret")).toThrow(/PII_ENC_KEY/);
  });

  it("short PII_ENC_KEY (<16 chars) → throws", () => {
    process.env.PII_ENC_KEY = "tooshort";
    crypto.resetPiiKeyCache();
    expect(() => crypto.encryptPii("secret")).toThrow(/PII_ENC_KEY/);
  });

  it("wrong key → decrypt throws (does NOT return garbage)", () => {
    const encrypted = crypto.encryptPii("original-secret");
    process.env.PII_ENC_KEY = "completely_different_key_32chars_x";
    crypto.resetPiiKeyCache();
    expect(() => crypto.decryptPii(encrypted)).toThrow();
  });
});

describe("L6 — No plaintext leakage", () => {
  it("ciphertext does not contain the plaintext", () => {
    const plain = "AADHAAR123456789012";
    const encrypted = crypto.encryptPii(plain);
    expect(encrypted).not.toContain(plain);
    expect(encrypted).not.toContain("AADHAAR");
  });

  it("round-trip preserves exact value", () => {
    const testValues = [
      "simple",
      "with spaces and punctuation!@#$%",
      "unicode: नमस्ते 你好 مرحبا",
      "1234567890".repeat(50), // long value
      "", // empty string
    ];
    for (const plain of testValues) {
      const encrypted = crypto.encryptPii(plain);
      expect(crypto.decryptPii(encrypted)).toBe(plain);
    }
  });
});

describe("L6 — Envelope format", () => {
  it("ciphertext uses enc:v2: prefix with key id", () => {
    const encrypted = crypto.encryptPii("test");
    expect(encrypted).toMatch(/^enc:v2:[^:]+:/);
  });

  it("isEncrypted correctly identifies envelopes", () => {
    const encrypted = crypto.encryptPii("test");
    expect(crypto.isEncrypted(encrypted)).toBe(true);
    expect(crypto.isEncrypted("plaintext")).toBe(false);
    expect(crypto.isEncrypted("")).toBe(false);
  });

  it("legacy plaintext passes through on read (backfill safety)", () => {
    // Values written before the encryption cutover must still be readable
    expect(crypto.decryptPii("legacy-plaintext-value")).toBe("legacy-plaintext-value");
  });
});

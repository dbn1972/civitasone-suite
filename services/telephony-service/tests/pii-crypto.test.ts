/**
 * pii-crypto unit tests — caller/callee numbers are PII.
 * Covers round-trip encrypt/decrypt, wrong-key → PiiDecryptError, blind-index
 * determinism, and mask output. No DB/Redis required.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptPii,
  decryptPii,
  isEncrypted,
  blindIndex,
  maskPhone,
  normalizePhone,
  resetPiiKeyCache,
  PiiDecryptError,
} from "../src/shared/pii-crypto.js";

const KEY_A = "test_telephony_key_aaaaaaaaaaaaaaaa";
const KEY_B = "test_telephony_key_bbbbbbbbbbbbbbbb";

function withKey(key: string) {
  process.env.TELEPHONY_PII_KEY = key;
  delete process.env.TELEPHONY_PII_KEYRING;
  delete process.env.TELEPHONY_PII_KEY_ID;
  delete process.env.TELEPHONY_PII_SALT;
  resetPiiKeyCache();
}

beforeEach(() => withKey(KEY_A));
afterEach(() => resetPiiKeyCache());

describe("pii-crypto round-trip", () => {
  it("encrypts then decrypts back to the original number", () => {
    const plain = "+91 98765 00011";
    const ct = encryptPii(plain);
    expect(ct.startsWith("enc:v2:")).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain("98765");
    expect(decryptPii(ct)).toBe(plain);
  });

  it("uses a fresh IV per call (ciphertext differs, plaintext same)", () => {
    const a = encryptPii("9876500011");
    const b = encryptPii("9876500011");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("passes legacy plaintext through decrypt untouched", () => {
    expect(decryptPii("9876500011")).toBe("9876500011");
    expect(isEncrypted("9876500011")).toBe(false);
  });
});

describe("pii-crypto wrong key", () => {
  it("throws PiiDecryptError when decrypting with a different key", () => {
    const ct = encryptPii("9876500011");
    withKey(KEY_B);
    expect(() => decryptPii(ct)).toThrow(PiiDecryptError);
  });
});

describe("pii-crypto blind index", () => {
  it("is deterministic and ignores formatting", () => {
    const a = blindIndex("+91 98765-00011");
    const b = blindIndex("+919876500011");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different numbers", () => {
    expect(blindIndex("9876500011")).not.toBe(blindIndex("9876500012"));
  });

  it("normalizes to digits + leading +", () => {
    expect(normalizePhone("+91 (98765) 00011")).toBe("+919876500011");
  });
});

describe("pii-crypto masking", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskPhone("9876500011")).toBe("******0011");
  });
  it("handles null + very short input safely", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12")).toBe("****");
  });
});

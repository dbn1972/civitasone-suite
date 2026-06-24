/**
 * crm-service: pii-crypto unit tests (P2-3).
 * Covers round-trip encrypt/decrypt, wrong-key -> PiiDecryptError,
 * blind-index determinism, and mask outputs. No DB/Redis required.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptPii,
  decryptPii,
  isEncrypted,
  blindIndex,
  maskEmail,
  maskPhone,
  resetPiiKeyCache,
  PiiDecryptError,
} from "../src/shared/pii-crypto.js";

const KEY_A = "test_pii_key_aaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "test_pii_key_bbbbbbbbbbbbbbbbbbbbbb";

function withKey(key: string) {
  process.env.CRM_PII_KEY = key;
  delete process.env.CRM_PII_KEYRING;
  delete process.env.CRM_PII_KEY_ID;
  delete process.env.CRM_PII_SALT;
  resetPiiKeyCache();
}

beforeEach(() => withKey(KEY_A));
afterEach(() => resetPiiKeyCache());

describe("pii-crypto round-trip", () => {
  it("encrypts then decrypts back to the original cleartext", () => {
    const plain = "rajesh.kumar@techcorp.in";
    const ct = encryptPii(plain);
    expect(ct.startsWith("enc:v2:")).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain(plain);
    expect(decryptPii(ct)).toBe(plain);
  });

  it("produces a fresh IV each call (ciphertext differs, plaintext same)", () => {
    const a = encryptPii("same@value.in");
    const b = encryptPii("same@value.in");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("passes legacy plaintext through decrypt untouched", () => {
    expect(decryptPii("legacy-plaintext@x.in")).toBe("legacy-plaintext@x.in");
    expect(isEncrypted("legacy-plaintext@x.in")).toBe(false);
  });
});

describe("pii-crypto wrong key", () => {
  it("throws PiiDecryptError when decrypting with a different key", () => {
    const ct = encryptPii("secret@value.in");
    withKey(KEY_B);
    expect(() => decryptPii(ct)).toThrow(PiiDecryptError);
  });

  it("throws PiiDecryptError on a tampered envelope", () => {
    const ct = encryptPii("secret@value.in");
    // Flip a char in the base64 body.
    const tampered = ct.slice(0, -2) + (ct.endsWith("A") ? "B" : "A") + "=";
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });
});

describe("pii-crypto blind index", () => {
  it("is deterministic and case/space-insensitive", () => {
    const a = blindIndex("  Rajesh.Kumar@TechCorp.IN ");
    const b = blindIndex("rajesh.kumar@techcorp.in");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different emails", () => {
    expect(blindIndex("a@x.in")).not.toBe(blindIndex("b@x.in"));
  });
});

describe("pii-crypto masking", () => {
  it("masks email to first char + domain", () => {
    expect(maskEmail("rajesh@techcorp.in")).toBe("r***@techcorp.in");
  });
  it("masks phone keeping last 4", () => {
    expect(maskPhone("9876543210")).toBe("******3210");
  });
  it("returns null/short inputs safely", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12")).toBe("****");
  });
});

/**
 * works-service: pii-crypto unit tests (SEC-011).
 * Covers round-trip encrypt/decrypt, wrong-key failure, isEncrypted detection,
 * and legacy-plaintext passthrough. No DB required — mirrors
 * crm-service/tests/pii-crypto.test.ts and the Property 2 suite in
 * procurement-service/tests/pii-encryption.property.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  encryptPii,
  decryptPii,
  isEncrypted,
  resetPiiKeyCache,
  PiiDecryptError,
} from "../src/shared/pii-crypto.js";

const KEY_A = "test_pii_key_aaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "test_pii_key_bbbbbbbbbbbbbbbbbbbbbb";

function withKey(key: string) {
  process.env.PII_ENC_KEY = key;
  process.env.PII_KEY_ID = "k1";
  delete process.env.PII_ENC_KEYRING;
  delete process.env.PII_ENC_SALT;
  resetPiiKeyCache();
}

beforeEach(() => withKey(KEY_A));
afterEach(() => resetPiiKeyCache());

/** PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter */
const panArb: fc.Arbitrary<string> = fc.tuple(
  fc.stringMatching(/^[A-Z]{5}$/),
  fc.stringMatching(/^[0-9]{4}$/),
  fc.stringMatching(/^[A-Z]$/),
).map(([a, b, c]) => `${a}${b}${c}`);

describe("pii-crypto round-trip", () => {
  it("encrypts then decrypts back to the original PAN", () => {
    const plain = "ABCDE1234F";
    const ct = encryptPii(plain);
    expect(ct.startsWith("enc:v2:")).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain(plain);
    expect(decryptPii(ct)).toBe(plain);
  });

  it("produces a fresh IV each call (ciphertext differs, plaintext same)", () => {
    const a = encryptPii("ABCDE1234F");
    const b = encryptPii("ABCDE1234F");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("passes legacy plaintext through decrypt untouched", () => {
    expect(decryptPii("ABCDE1234F")).toBe("ABCDE1234F");
  });

  it("property: for any valid PAN, encrypt->decrypt round-trips and ciphertext never equals plaintext", () => {
    fc.assert(
      fc.property(panArb, (plaintext) => {
        const ciphertext = encryptPii(plaintext);
        expect(ciphertext).not.toBe(plaintext);
        expect(isEncrypted(ciphertext)).toBe(true);
        expect(decryptPii(ciphertext)).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });
});

describe("pii-crypto wrong key", () => {
  it("fails closed (PiiDecryptError) when decrypting with a different key", () => {
    const ct = encryptPii("ABCDE1234F");
    withKey(KEY_B);
    expect(() => decryptPii(ct)).toThrow(PiiDecryptError);
  });
});

describe("pii-crypto missing key", () => {
  it("throws if PII_ENC_KEY is not configured", () => {
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();
    expect(() => encryptPii("ABCDE1234F")).toThrow(/PII_ENC_KEY is required/);
  });
});

/**
 * Feature: visitor-management, Property 24: PII Encryption Round-Trip
 *
 * For any valid PII string (PAN, email, phone, bank account, IFSC),
 * encrypting it via encryptPii() and then decrypting should produce the
 * original plaintext value, and the ciphertext stored in the database
 * should never equal the original plaintext.
 *
 * **Validates: Requirements 18.2**
 *
 * Tests the pure encryptPii/decryptPii functions directly rather than the
 * Drizzle `encryptedText()` custom type wrapper, since that wrapper requires
 * a live DB connection to exercise (toDriver/fromDriver are invoked by
 * Drizzle during actual reads/writes).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";

// pii-crypto.ts fails closed (throws) if VISITOR_PII_KEY is missing/short, so
// it must be set before the module is loaded (readMasterSecret() runs lazily
// on first keyring() call, but set it up-front for determinism across runs).
beforeAll(() => {
  process.env.VISITOR_PII_KEY = "test-visitor-pii-key-32-chars-long";
});

describe("Property 24: PII Encryption Round-Trip", () => {
  it("encrypt(plain) then decrypt returns the original plaintext, for any non-empty string", async () => {
    const { encryptPii, decryptPii } = await import("../../src/shared/pii-crypto.js");

    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (plain) => {
        const encrypted = encryptPii(plain);
        const decrypted = decryptPii(encrypted);
        expect(decrypted).toBe(plain);
      }),
      { numRuns: 100 },
    );
  });

  it("realistic PII shapes (PAN, email, phone, bank account, IFSC) round-trip correctly", async () => {
    const { encryptPii, decryptPii } = await import("../../src/shared/pii-crypto.js");

    // fast-check 4.x has no `stringOf` helper; build fixed-alphabet strings
    // via fc.array(...).map(join) instead.
    const charsOf = (alphabet: string, length: number) =>
      fc.array(fc.constantFrom(...alphabet), { minLength: length, maxLength: length }).map((cs) => cs.join(""));

    const panArb = fc.tuple(
      charsOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 5),
      charsOf("0123456789", 4),
      fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ).map(([a, b, c]) => `${a}${b}${c}`);

    const emailArb = fc.tuple(
      fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), { minLength: 1, maxLength: 15 }).map((cs) => cs.join("")),
      fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 2, maxLength: 10 }).map((cs) => cs.join("")),
    ).map(([local, domain]) => `${local}@${domain}.gov.in`);

    const phoneArb = charsOf("0123456789", 10).map((digits) => `+91${digits}`);

    const bankAccountArb = fc
      .array(fc.constantFrom(..."0123456789"), { minLength: 9, maxLength: 18 })
      .map((cs) => cs.join(""));

    const ifscArb = fc.tuple(
      charsOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 4),
      charsOf("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 6),
    ).map(([bank, branch]) => `${bank}0${branch}`);

    fc.assert(
      fc.property(fc.oneof(panArb, emailArb, phoneArb, bankAccountArb, ifscArb), (piiValue) => {
        const encrypted = encryptPii(piiValue);
        expect(decryptPii(encrypted)).toBe(piiValue);
      }),
      { numRuns: 100 },
    );
  });

  it("the stored ciphertext never equals the original plaintext (for non-empty strings)", async () => {
    const { encryptPii } = await import("../../src/shared/pii-crypto.js");

    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (plain) => {
        const encrypted = encryptPii(plain);
        expect(encrypted).not.toBe(plain);
      }),
      { numRuns: 100 },
    );
  });

  it("isEncrypted() returns true for any encrypted output", async () => {
    const { encryptPii, isEncrypted } = await import("../../src/shared/pii-crypto.js");

    fc.assert(
      fc.property(fc.string(), (plain) => {
        const encrypted = encryptPii(plain);
        expect(isEncrypted(encrypted)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("decrypting legacy plaintext (no enc: prefix) passes it through unchanged", async () => {
    const { decryptPii, isEncrypted } = await import("../../src/shared/pii-crypto.js");

    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.startsWith("enc:v2:")),
        (legacyPlain) => {
          expect(isEncrypted(legacyPlain)).toBe(false);
          expect(decryptPii(legacyPlain)).toBe(legacyPlain);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property-Based Tests for PII Encryption and Role-Based Access Control.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * **Validates: Requirements 2.1, 2.3, 2.4, 2.5**
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fc from "fast-check";
import { encryptPii, decryptPii, isEncrypted, resetPiiKeyCache } from "../src/shared/pii-crypto.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000099";

beforeAll(() => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!";
  process.env.PII_KEY_ID = "k1";
  resetPiiKeyCache();
});

afterAll(async () => { await sqlClient.end(); });

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter */
const panArb: fc.Arbitrary<string> = fc.tuple(
  fc.stringMatching(/^[A-Z]{5}$/),
  fc.stringMatching(/^[0-9]{4}$/),
  fc.stringMatching(/^[A-Z]$/),
).map(([a, b, c]) => `${a}${b}${c}`);

/** Email: simple valid format */
const emailArb: fc.Arbitrary<string> = fc.tuple(
  fc.stringMatching(/^[a-z][a-z0-9]{1,20}$/),
  fc.stringMatching(/^[a-z]{2,10}$/),
  fc.stringMatching(/^[a-z]{2,5}$/),
).map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

/** Indian phone number: 10-digit starting with 6-9, optionally prefixed with +91 */
const phoneArb: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom("+91", ""),
  fc.stringMatching(/^[6-9][0-9]{9}$/),
).map(([prefix, num]) => `${prefix}${num}`);

/** Bank account number: 9 to 18 digits */
const bankAccountArb: fc.Arbitrary<string> = fc.stringMatching(/^[0-9]{9,18}$/);

/** IFSC code: 4 uppercase letters + 0 + 6 alphanumeric characters */
const ifscArb: fc.Arbitrary<string> = fc.tuple(
  fc.stringMatching(/^[A-Z]{4}$/),
  fc.stringMatching(/^[A-Z0-9]{6}$/),
).map(([bank, branch]) => `${bank}0${branch}`);

/** Any valid PII string from any of the 5 PII field types */
const piiStringArb: fc.Arbitrary<string> = fc.oneof(
  panArb,
  emailArb,
  phoneArb,
  bankAccountArb,
  ifscArb,
);

/** Roles that are authorized to view PII */
const authorizedRoles = [
  "procurement_officer",
  "procurement_admin",
  "finance_officer",
  "tenant_admin",
  "super_admin",
  "audit_officer",
] as const;

/** Roles that are NOT authorized to view PII */
const unauthorizedRoles = [
  "employee",
  "hr_officer",
  "hr_admin",
  "citizen",
  "project_manager",
  "store_keeper",
  "it_admin",
  "data_entry",
  "clerk",
  "driver",
] as const;

const unauthorizedRoleArb: fc.Arbitrary<string> = fc.constantFrom(...unauthorizedRoles);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 2: PII Encryption Round-Trip", () => {
  /**
   * For any valid PII string (PAN, email, phone, bank account, IFSC),
   * encrypting via encryptedText() and then decrypting should produce the
   * original plaintext value.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it("encrypt then decrypt produces the original plaintext for any valid PII", () => {
    fc.assert(
      fc.property(piiStringArb, (plaintext) => {
        const ciphertext = encryptPii(plaintext);
        const decrypted = decryptPii(ciphertext);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any valid PII string, the ciphertext stored in the database should
   * never equal the original plaintext.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it("ciphertext never equals the original plaintext", () => {
    fc.assert(
      fc.property(piiStringArb, (plaintext) => {
        const ciphertext = encryptPii(plaintext);
        expect(ciphertext).not.toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any valid PII string, the encrypted output is recognized as encrypted
   * by isEncrypted().
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it("encrypted output is always detected as encrypted by isEncrypted()", () => {
    fc.assert(
      fc.property(piiStringArb, (plaintext) => {
        const ciphertext = encryptPii(plaintext);
        expect(isEncrypted(ciphertext)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any valid PII string, encrypting twice produces different ciphertexts
   * (non-deterministic due to random IV) but both decrypt to the same plaintext.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it("same plaintext produces different ciphertext each time (random IV)", () => {
    fc.assert(
      fc.property(piiStringArb, (plaintext) => {
        const ct1 = encryptPii(plaintext);
        const ct2 = encryptPii(plaintext);
        // Different ciphertexts due to random IV
        expect(ct1).not.toBe(ct2);
        // But both decrypt to same plaintext
        expect(decryptPii(ct1)).toBe(plaintext);
        expect(decryptPii(ct2)).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any valid PII string, the ciphertext envelope has the expected v2 prefix format.
   *
   * **Validates: Requirements 2.1**
   */
  it("ciphertext has enc:v2:<keyId>: prefix format", () => {
    fc.assert(
      fc.property(piiStringArb, (plaintext) => {
        const ciphertext = encryptPii(plaintext);
        expect(ciphertext.startsWith("enc:v2:k1:")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 3: PII Role-Based Access Control", () => {
  /**
   * For any user without one of the authorized PII roles, requesting
   * a vendor record SHALL return 403 with PII fields absent.
   *
   * **Validates: Requirements 2.4, 2.5**
   */
  it("unauthorized roles receive 403 when requesting vendor list", () => {
    fc.assert(
      fc.asyncProperty(unauthorizedRoleArb, async (role) => {
        const token = signToken(
          { sub: "user-pbt-test", tid: TENANT, roles: [role], sid: "sess-pbt-001" },
          SECRET,
        );
        const app = await buildApp();
        try {
          const res = await app.inject({
            method: "GET",
            url: "/v1/procurement/vendors",
            headers: { authorization: `Bearer ${token}` },
          });
          expect(res.statusCode).toBe(403);

          // Verify no PII fields leaked in the response body
          const body = res.json();
          const piiFields = ["pan", "email", "phone", "bankAccount", "ifsc"];
          if (body.data && Array.isArray(body.data)) {
            for (const record of body.data) {
              for (const field of piiFields) {
                expect(record).not.toHaveProperty(field);
              }
            }
          }
        } finally {
          await app.close();
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * For any user without one of the authorized PII roles, requesting
   * a specific vendor record by ID SHALL return 403 with PII fields absent.
   *
   * **Validates: Requirements 2.4, 2.5**
   */
  it("unauthorized roles receive 403 when requesting vendor by ID", () => {
    fc.assert(
      fc.asyncProperty(unauthorizedRoleArb, async (role) => {
        const token = signToken(
          { sub: "user-pbt-test", tid: TENANT, roles: [role], sid: "sess-pbt-002" },
          SECRET,
        );
        const app = await buildApp();
        try {
          const res = await app.inject({
            method: "GET",
            url: "/v1/procurement/vendors/00000000-0000-4000-8000-000000000001",
            headers: { authorization: `Bearer ${token}` },
          });
          expect(res.statusCode).toBe(403);

          // Verify no PII fields in response
          const body = res.json();
          const piiFields = ["pan", "email", "phone", "bankAccount", "ifsc"];
          for (const field of piiFields) {
            expect(body).not.toHaveProperty(field);
          }
          if (body.data) {
            for (const field of piiFields) {
              expect(body.data).not.toHaveProperty(field);
            }
          }
        } finally {
          await app.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});

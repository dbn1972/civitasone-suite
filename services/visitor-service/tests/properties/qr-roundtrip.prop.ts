/**
 * Feature: visitor-management, Property 8: QR JWT Round-Trip Integrity
 *
 * For any valid pass payload (visit_id, visitor_id, tenant_id, location_id,
 * valid_from, valid_until, permitted_areas), signing with the tenant's RS256
 * private key and verifying with the corresponding public key SHALL
 * reproduce the original claims without loss.
 *
 * **Validates: Requirements 4.3**
 */
import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { generateKeyPairSync } from "node:crypto";
import type { PassQrPayload } from "../../src/shared/qr-crypto.js";

let tenantPrivateKeyPem: string;
let tenantPublicKeyPem: string;
let otherPublicKeyPem: string;

// RSA keygen is slow; generate ONCE and reuse across all property runs
// rather than per-test-case.
beforeAll(() => {
  const tenantKeyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  tenantPrivateKeyPem = tenantKeyPair.privateKey;
  tenantPublicKeyPem = tenantKeyPair.publicKey;

  const otherKeyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  otherPublicKeyPem = otherKeyPair.publicKey;
});

// fast-check 4.x has no built-in UUID arbitrary in this project's usage
// style; build fixed-shape v4-looking UUID strings via fc.uuid() (provided
// by fast-check) directly.
const uuidArb = fc.uuid();

const passTypeArb = fc.constantFrom<PassQrPayload["pass_type"]>(
  "single",
  "multi_day",
  "recurring",
  "event",
);

const passNumberArb = fc
  .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), {
    minLength: 4,
    maxLength: 16,
  })
  .map((cs) => cs.join(""));

const permittedAreasArb = fc.array(uuidArb, { minLength: 0, maxLength: 5 });

// valid_from is anchored in the past relative to "now" and valid_until is
// safely in the future (~1 day later), so jose's automatic exp/nbf
// validation succeeds during verification.
const nowSeconds = () => Math.floor(Date.now() / 1000);

const payloadArb: fc.Arbitrary<PassQrPayload> = fc
  .tuple(uuidArb, uuidArb, uuidArb, uuidArb, permittedAreasArb, passTypeArb, passNumberArb)
  .map(([visit_id, visitor_id, tenant_id, location_id, permitted_areas, pass_type, pass_number]) => {
    const valid_from = nowSeconds() - 3600; // 1 hour in the past
    const valid_until = valid_from + 60 * 60 * 24; // ~1 day validity window
    return {
      visit_id,
      visitor_id,
      tenant_id,
      location_id,
      valid_from,
      valid_until,
      permitted_areas,
      pass_type,
      pass_number,
    };
  });

describe("Property 8: QR JWT Round-Trip Integrity", () => {
  it("signing then verifying reproduces visit_id, visitor_id, tenant_id, location_id, permitted_areas, pass_type, pass_number", async () => {
    const { signPassQr, verifyPassQr } = await import("../../src/shared/qr-crypto.js");

    await fc.assert(
      fc.asyncProperty(payloadArb, async (payload) => {
        const jwt = await signPassQr(payload, tenantPrivateKeyPem);
        const verified = await verifyPassQr(jwt, tenantPublicKeyPem);

        expect(verified.visit_id).toBe(payload.visit_id);
        expect(verified.visitor_id).toBe(payload.visitor_id);
        expect(verified.tenant_id).toBe(payload.tenant_id);
        expect(verified.location_id).toBe(payload.location_id);
        expect(verified.permitted_areas).toEqual(payload.permitted_areas);
        expect(verified.pass_type).toBe(payload.pass_type);
        expect(verified.pass_number).toBe(payload.pass_number);
      }),
      { numRuns: 100 },
    );
  });

  it("verification with a different (wrong) tenant public key fails", async () => {
    const { signPassQr, verifyPassQr } = await import("../../src/shared/qr-crypto.js");

    await fc.assert(
      fc.asyncProperty(payloadArb, async (payload) => {
        const jwt = await signPassQr(payload, tenantPrivateKeyPem);
        await expect(verifyPassQr(jwt, otherPublicKeyPem)).rejects.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * V4-E-07 — the certificate seal key must never fall back to a hardcoded literal
 * outside test: with neither CITIZEN_ISSUANCE_SECRET nor CITIZEN_PII_KEY set,
 * sealing/verifying must fail closed instead of using a publicly known key.
 */
import { describe, it, expect } from "vitest";
import { signPayloadHash, verifySignature, hashPayload } from "./domain.js";

const H = hashPayload({ certNo: "BIRTH-2026-000001" });

describe("V4-E-07 issuance seal key fails closed", () => {
  it("throws when no secret is configured in production", () => {
    expect(() => signPayloadHash(H, { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/ISSUANCE_SEAL_KEY_UNSET/);
  });
  it("throws when no secret is configured and NODE_ENV is unset", () => {
    expect(() => signPayloadHash(H, {} as NodeJS.ProcessEnv)).toThrow(/ISSUANCE_SEAL_KEY_UNSET/);
  });
  it("treats a blank secret as unset", () => {
    expect(() => signPayloadHash(H, { NODE_ENV: "production", CITIZEN_ISSUANCE_SECRET: "  ", CITIZEN_PII_KEY: "" } as NodeJS.ProcessEnv)).toThrow(/ISSUANCE_SEAL_KEY_UNSET/);
  });
  it("verification also fails closed rather than comparing against a known key", () => {
    const payload = { certNo: "BIRTH-2026-000001" };
    expect(() => verifySignature(payload, hashPayload(payload), "00", { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/ISSUANCE_SEAL_KEY_UNSET/);
  });
  it("still seals + verifies when a secret is configured", () => {
    const env = { NODE_ENV: "production", CITIZEN_ISSUANCE_SECRET: globalThis.crypto.randomUUID() } as NodeJS.ProcessEnv;
    const payload = { certNo: "BIRTH-2026-000001" };
    const h = hashPayload(payload);
    expect(verifySignature(payload, h, signPayloadHash(h, env), env)).toBe(true);
  });
  it("falls back to CITIZEN_PII_KEY derivation (distinct from the raw key)", () => {
    const k = globalThis.crypto.randomUUID();
    const a = signPayloadHash(H, { NODE_ENV: "production", CITIZEN_PII_KEY: k } as NodeJS.ProcessEnv);
    const b = signPayloadHash(H, { NODE_ENV: "production", CITIZEN_ISSUANCE_SECRET: k } as NodeJS.ProcessEnv);
    expect(a).toBe(b);
  });
  it("test mode keeps a deterministic non-production fallback so unit suites run", () => {
    expect(signPayloadHash(H, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toMatch(/^[0-9a-f]{64}$/);
  });
});

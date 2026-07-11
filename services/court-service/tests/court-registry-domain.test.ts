/**
 * Pure-domain tests for court-registry: deterministic id derivation
 * (idempotency keys) and establishment-code normalization.
 */
import { describe, it, expect } from "vitest";
import {
  deterministicId,
  normalizeEstablishmentCode,
  deriveCourtId,
  deriveBenchId,
} from "../src/modules/court-registry/domain.js";

describe("court-registry domain — id derivation", () => {
  it("deterministicId is a valid, stable UUIDv5 for the same inputs", () => {
    const a = deterministicId("b2e7a4d1-9c33-4f0a-8e21-5d6c7b8a9f01", "tenant:court:DLHC01");
    const b = deterministicId("b2e7a4d1-9c33-4f0a-8e21-5d6c7b8a9f01", "tenant:court:DLHC01");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("different names produce different ids (collision-free)", () => {
    const ns = "b2e7a4d1-9c33-4f0a-8e21-5d6c7b8a9f01";
    expect(deterministicId(ns, "a")).not.toBe(deterministicId(ns, "b"));
  });

  it("normalizeEstablishmentCode strips whitespace and upper-cases", () => {
    expect(normalizeEstablishmentCode(" dl hc-01 ")).toBe("DLHC-01");
  });

  it("deriveCourtId is idempotent on (tenant, establishmentCode) and ignores the fallback", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const first = deriveCourtId(t, "TEH-001", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const again = deriveCourtId(t, "teh-001", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"); // case-normalized-equal
    expect(first).toBe(again);
  });

  it("deriveCourtId falls back to the random id when no establishment code is given", () => {
    const fb = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    expect(deriveCourtId("t", undefined, fb)).toBe(fb);
  });

  it("deriveBenchId is deterministic per (tenant, court, bench name)", () => {
    const t = "22222222-2222-2222-2222-222222222222";
    const c = "33333333-3333-3333-3333-333333333333";
    expect(deriveBenchId(t, c, "Court No. 1")).toBe(deriveBenchId(t, c, "  court no. 1 "));
    expect(deriveBenchId(t, c, "Court No. 1")).not.toBe(deriveBenchId(t, c, "Court No. 2"));
  });
});

/**
 * DID-to-tenant mapping tests.
 *
 * Tests the pure domain function `resolveTenant` for DID resolution,
 * number normalization, and route-level CRUD for DID mappings.
 *
 * Validates: Requirements 15.2
 */
import { describe, it, expect } from "vitest";
import { resolveTenant, normalizeNumber, DEFAULT_TENANT_ID, type DidMapping } from "../src/modules/did/domain.js";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FALLBACK = "00000000-0000-0000-0000-000000000001";

const mappings: DidMapping[] = [
  { didNumber: "+918001112222", tenantId: TENANT_A, active: true },
  { didNumber: "+918003334444", tenantId: TENANT_B, active: true },
  { didNumber: "+918005556666", tenantId: TENANT_A, active: false }, // inactive
];

// ── normalizeNumber ───────────────────────────────────────────────

describe("normalizeNumber", () => {
  it("strips whitespace from phone numbers", () => {
    expect(normalizeNumber("+91 800 111 2222")).toBe("+918001112222");
  });

  it("strips dashes from phone numbers", () => {
    expect(normalizeNumber("+91-800-111-2222")).toBe("+918001112222");
  });

  it("strips parentheses from phone numbers", () => {
    expect(normalizeNumber("(+91)8001112222")).toBe("+918001112222");
  });

  it("keeps already-normalized numbers unchanged", () => {
    expect(normalizeNumber("+918001112222")).toBe("+918001112222");
  });

  it("handles empty string", () => {
    expect(normalizeNumber("")).toBe("");
  });

  it("handles mixed formatting", () => {
    expect(normalizeNumber("+91 (800) 111-2222")).toBe("+918001112222");
  });
});

// ── resolveTenant ─────────────────────────────────────────────────

describe("resolveTenant", () => {
  it("resolves a known DID to the correct tenant", () => {
    const result = resolveTenant("+918001112222", mappings, FALLBACK);
    expect(result).toBe(TENANT_A);
  });

  it("resolves a different known DID to its tenant", () => {
    const result = resolveTenant("+918003334444", mappings, FALLBACK);
    expect(result).toBe(TENANT_B);
  });

  it("falls back to defaultTenantId for unknown DID", () => {
    const result = resolveTenant("+919999999999", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("falls back when calleeNumber is empty", () => {
    const result = resolveTenant("", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("skips inactive mappings and falls back", () => {
    // +918005556666 is mapped but inactive
    const result = resolveTenant("+918005556666", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("matches normalized numbers (spaces/dashes stripped)", () => {
    // The stored DID is "+918001112222", caller dials with formatting
    const result = resolveTenant("+91 800-111-2222", mappings, FALLBACK);
    expect(result).toBe(TENANT_A);
  });

  it("handles empty mappings list gracefully", () => {
    const result = resolveTenant("+918001112222", [], FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("uses the provided default tenant ID (not a hardcoded value)", () => {
    const customFallback = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const result = resolveTenant("+919999999999", mappings, customFallback);
    expect(result).toBe(customFallback);
  });

  it("resolves correctly when multiple DIDs map to the same tenant", () => {
    const multiMappings: DidMapping[] = [
      { didNumber: "+911111111111", tenantId: TENANT_A, active: true },
      { didNumber: "+912222222222", tenantId: TENANT_A, active: true },
    ];
    expect(resolveTenant("+911111111111", multiMappings, FALLBACK)).toBe(TENANT_A);
    expect(resolveTenant("+912222222222", multiMappings, FALLBACK)).toBe(TENANT_A);
  });

  it("matches first active mapping when duplicates exist", () => {
    const dupes: DidMapping[] = [
      { didNumber: "+918001112222", tenantId: TENANT_A, active: true },
      { didNumber: "+918001112222", tenantId: TENANT_B, active: true },
    ];
    // First match wins
    expect(resolveTenant("+918001112222", dupes, FALLBACK)).toBe(TENANT_A);
  });
});

// ── DEFAULT_TENANT_ID ─────────────────────────────────────────────

describe("DEFAULT_TENANT_ID", () => {
  it("has a valid UUID fallback", () => {
    // Either from env or the hardcoded fallback
    expect(DEFAULT_TENANT_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

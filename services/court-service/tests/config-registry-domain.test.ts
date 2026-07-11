/** Pure-domain tests for config id derivation + namespace/key validation (§47). */
import { describe, it, expect } from "vitest";
import {
  deriveConfigId, assertValidNamespace, assertValidKey,
  NAMESPACE_PATTERN, KEY_PATTERN, KNOWN_NAMESPACES,
} from "../src/modules/config-registry/domain.js";

const T = "11111111-1111-1111-1111-111111111111";

describe("config domain — id derivation", () => {
  it("deriveConfigId is deterministic per (tenant, namespace, key)", () => {
    expect(deriveConfigId(T, "court_type", "district")).toBe(deriveConfigId(T, "court_type", "district"));
  });

  it("deriveConfigId differs across namespace, key, and tenant", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    expect(deriveConfigId(T, "court_type", "district")).not.toBe(deriveConfigId(T, "case_type", "district"));
    expect(deriveConfigId(T, "court_type", "district")).not.toBe(deriveConfigId(T, "court_type", "high"));
    expect(deriveConfigId(T, "court_type", "district")).not.toBe(deriveConfigId(other, "court_type", "district"));
  });

  it("KNOWN_NAMESPACES all match NAMESPACE_PATTERN", () => {
    for (const ns of KNOWN_NAMESPACES) expect(NAMESPACE_PATTERN.test(ns)).toBe(true);
  });
});

describe("config domain — namespace validation", () => {
  it("accepts valid lowercase snake namespaces", () => {
    expect(() => assertValidNamespace("court_type")).not.toThrow();
    expect(() => assertValidNamespace("fee_schedule")).not.toThrow();
  });

  it("rejects invalid namespaces with INVALID_CONFIG_NAMESPACE", () => {
    expect(() => assertValidNamespace("Court_Type")).toThrow(/INVALID_CONFIG_NAMESPACE/);
    expect(() => assertValidNamespace("1bad")).toThrow(/INVALID_CONFIG_NAMESPACE/);
    expect(() => assertValidNamespace("a")).toThrow(/INVALID_CONFIG_NAMESPACE/); // too short
    expect(() => assertValidNamespace("has-dash")).toThrow(/INVALID_CONFIG_NAMESPACE/);
  });
});

describe("config domain — key validation", () => {
  it("accepts valid keys including dotted ones", () => {
    expect(() => assertValidKey("district")).not.toThrow();
    expect(() => assertValidKey("fee.filing.civil")).not.toThrow();
    expect(() => assertValidKey("SLA-timer_01")).not.toThrow();
    expect(KEY_PATTERN.test("a")).toBe(true);
  });

  it("rejects invalid keys with INVALID_CONFIG_KEY", () => {
    expect(() => assertValidKey("")).toThrow(/INVALID_CONFIG_KEY/);
    expect(() => assertValidKey(".leading-dot")).toThrow(/INVALID_CONFIG_KEY/);
    expect(() => assertValidKey("has space")).toThrow(/INVALID_CONFIG_KEY/);
  });
});

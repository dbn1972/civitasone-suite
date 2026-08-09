/**
 * Tenant Service — Domain: Deep tests.
 *
 * Tests tenant lifecycle state machine with all valid/invalid transitions.
 * Source: modules/tenant/domain.ts
 */
import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, DomainError } from "../src/modules/tenant/domain.js";

describe("canTransition — tenant lifecycle", () => {
  const valid: [string, string][] = [
    ["draft", "active"], ["draft", "archived"],
    ["active", "suspended"], ["active", "restricted"], ["active", "offboarding"],
    ["suspended", "active"], ["suspended", "offboarding"],
    ["restricted", "active"], ["restricted", "suspended"],
    ["offboarding", "archived"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(canTransition(from as any, to as any)).toBe(true));
  }

  const invalid: [string, string][] = [
    ["draft", "suspended"], ["draft", "offboarding"],
    ["active", "draft"], ["active", "archived"],
    ["suspended", "draft"], ["suspended", "archived"],
    ["restricted", "draft"], ["restricted", "archived"], ["restricted", "offboarding"],
    ["offboarding", "active"], ["offboarding", "draft"],
    ["archived", "active"], ["archived", "draft"], ["archived", "suspended"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(canTransition(from as any, to as any)).toBe(false));
  }

  it("archived is fully terminal", () => {
    for (const target of ["draft", "active", "suspended", "restricted", "offboarding"]) {
      expect(canTransition("archived" as any, target as any)).toBe(false);
    }
  });
});

describe("assertTransition", () => {
  it("throws DomainError for illegal transition", () => {
    expect(() => assertTransition("archived" as any, "active" as any)).toThrow(DomainError);
  });
  it("does not throw for valid transition", () => {
    expect(() => assertTransition("draft" as any, "active" as any)).not.toThrow();
  });
  it("error code is INVALID_TRANSITION", () => {
    try { assertTransition("archived" as any, "active" as any); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

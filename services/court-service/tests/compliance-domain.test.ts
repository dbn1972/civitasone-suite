/** Pure-domain tests for the compliance state machine + id derivation (§26). */
import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, isTerminal, deriveDirectionId } from "../src/modules/compliance/domain.js";

describe("compliance domain — state machine", () => {
  it("a pending direction can start progress or be flagged non_compliant", () => {
    expect(canTransition("pending", "in_progress")).toBe(true);
    expect(canTransition("pending", "non_compliant")).toBe(true);
  });

  it("in_progress can complete or fail; completed can be verified", () => {
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("in_progress", "non_compliant")).toBe(true);
    expect(canTransition("completed", "verified")).toBe(true);
  });

  it("rejects illegal transitions (skipping states / going backwards)", () => {
    expect(canTransition("pending", "completed")).toBe(false);
    expect(canTransition("pending", "verified")).toBe(false);
    expect(canTransition("in_progress", "verified")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(() => assertTransition("pending", "verified")).toThrow(/INVALID_COMPLIANCE_TRANSITION/);
  });

  it("terminal states cannot transition further", () => {
    expect(canTransition("verified", "non_compliant")).toBe(false);
    expect(canTransition("non_compliant", "in_progress")).toBe(false);
    expect(isTerminal("verified")).toBe(true);
    expect(isTerminal("non_compliant")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("in_progress")).toBe(false);
    expect(isTerminal("completed")).toBe(false);
    expect(() => assertTransition("verified", "non_compliant")).toThrow(/INVALID_COMPLIANCE_TRANSITION/);
  });

  it("deriveDirectionId is deterministic per (tenant, case, order, seq)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const o = "33333333-3333-3333-3333-333333333333";
    expect(deriveDirectionId(t, c, o, 1)).toBe(deriveDirectionId(t, c, o, 1));
    expect(deriveDirectionId(t, c, o, 1)).not.toBe(deriveDirectionId(t, c, o, 2));
    expect(deriveDirectionId(t, c, o, 1)).not.toBe(deriveDirectionId(t, c, undefined, 1));
  });
});

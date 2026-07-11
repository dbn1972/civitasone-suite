/** Pure-domain tests for the evidence state machine, id derivation, and hash check. */
import { describe, it, expect } from "vitest";
import {
  canTransition, assertTransition, isTerminal, validateContentHash, deriveEvidenceId,
} from "../src/modules/evidence/domain.js";

describe("evidence domain — state machine", () => {
  it("a submitted exhibit can be admitted, rejected or marked", () => {
    expect(canTransition("submitted", "admitted")).toBe(true);
    expect(canTransition("submitted", "rejected")).toBe(true);
    expect(canTransition("submitted", "marked")).toBe(true);
  });

  it("a marked exhibit can be admitted or rejected", () => {
    expect(canTransition("marked", "admitted")).toBe(true);
    expect(canTransition("marked", "rejected")).toBe(true);
    expect(canTransition("marked", "submitted")).toBe(false);
  });

  it("terminal states cannot transition further", () => {
    expect(isTerminal("admitted")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("submitted")).toBe(false);
    expect(isTerminal("marked")).toBe(false);
    expect(canTransition("admitted", "rejected")).toBe(false);
    expect(canTransition("rejected", "admitted")).toBe(false);
    expect(() => assertTransition("admitted", "rejected")).toThrow(/INVALID_EVIDENCE_TRANSITION/);
  });

  it("validateContentHash accepts a 64-char hex SHA-256 and rejects otherwise", () => {
    expect(validateContentHash("a".repeat(64))).toBe(true);
    expect(validateContentHash("A".repeat(64))).toBe(true);
    expect(validateContentHash("a".repeat(63))).toBe(false);
    expect(validateContentHash("g".repeat(64))).toBe(false);
    expect(validateContentHash("")).toBe(false);
  });

  it("deriveEvidenceId is deterministic per (tenant, case, exhibit/title, seq)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    expect(deriveEvidenceId(t, c, "EX-1", 0)).toBe(deriveEvidenceId(t, c, "EX-1", 0));
    expect(deriveEvidenceId(t, c, "EX-1", 0)).not.toBe(deriveEvidenceId(t, c, "EX-1", 1));
    expect(deriveEvidenceId(t, c, "EX-1", 0)).not.toBe(deriveEvidenceId(t, c, "EX-2", 0));
  });
});

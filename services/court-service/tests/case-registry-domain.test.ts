/**
 * Pure-domain tests for case-registry: the CNR guard, initial-status
 * derivation, and the lifecycle state machine (legal + illegal transitions).
 */
import { describe, it, expect } from "vitest";
import {
  CASE_STATUSES,
  validateCnr,
  normalizeCnr,
  deriveInitialStatus,
  canTransition,
  assertTransition,
} from "../src/modules/case-registry/domain.js";

describe("case-registry domain — validateCnr", () => {
  it("accepts and normalizes a 16-char CNR with separators", () => {
    expect(validateCnr("DLHC01-00012342026")).toBe("DLHC0100012342026".slice(0, 16));
  });

  it("normalizes case and strips non-alphanumerics", () => {
    expect(normalizeCnr("dlhc01-0001234-9")).toBe("DLHC0100012349");
  });

  it("rejects a too-short CNR", () => {
    expect(() => validateCnr("ABC123")).toThrow(/INVALID_CNR/);
  });

  it("rejects a CNR with invalid characters after normalization is still wrong length", () => {
    expect(() => validateCnr("!!!")).toThrow(/INVALID_CNR/);
  });
});

describe("case-registry domain — deriveInitialStatus", () => {
  it("always starts a case in 'filed'", () => {
    expect(deriveInitialStatus()).toBe("filed");
    expect(CASE_STATUSES).toContain(deriveInitialStatus());
  });
});

describe("case-registry domain — state machine", () => {
  it("allows the forward spine transitions", () => {
    expect(canTransition("filed", "registered")).toBe(true);
    expect(canTransition("registered", "admitted")).toBe(true);
    expect(canTransition("admitted", "pending")).toBe(true);
    expect(canTransition("pending", "part_heard")).toBe(true);
    expect(canTransition("part_heard", "reserved")).toBe(true);
    expect(canTransition("reserved", "disposed")).toBe(true);
    expect(canTransition("disposed", "appealed")).toBe(true);
  });

  it("assertTransition does not throw for a legal move", () => {
    expect(() => assertTransition("filed", "registered")).not.toThrow();
    expect(() => assertTransition("pending", "disposed")).not.toThrow();
  });

  it("rejects skipping the pipeline", () => {
    expect(canTransition("filed", "disposed")).toBe(false);
    expect(canTransition("filed", "admitted")).toBe(false);
    expect(canTransition("registered", "pending")).toBe(false);
  });

  it("assertTransition throws INVALID_TRANSITION for an illegal move", () => {
    expect(() => assertTransition("filed", "disposed")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertTransition("disposed", "filed")).toThrow(/INVALID_TRANSITION/);
  });

  it("rejects transitions from an unknown source status", () => {
    expect(canTransition("bogus" as never, "registered")).toBe(false);
  });
});

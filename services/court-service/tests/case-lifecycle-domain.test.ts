/** Pure-domain tests for the case-lifecycle state machine. */
import { describe, it, expect } from "vitest";
import { assertTransition, canTransition, isTerminal, deriveStage } from "../src/modules/case-lifecycle/domain.js";

describe("case-lifecycle domain — state machine", () => {
  it("allows the forward spine", () => {
    expect(canTransition("filed", "registered")).toBe(true);
    expect(canTransition("registered", "admitted")).toBe(true);
    expect(canTransition("admitted", "pending")).toBe(true);
    expect(canTransition("pending", "reserved")).toBe(true);
    expect(canTransition("reserved", "disposed")).toBe(true);
    expect(canTransition("disposed", "appealed")).toBe(true);
  });

  it("allows realistic side-branches", () => {
    expect(canTransition("reserved", "part_heard")).toBe(true); // re-open for further hearing
    expect(canTransition("appealed", "pending")).toBe(true);    // appellate pipeline
  });

  it("rejects illegal edges", () => {
    expect(canTransition("filed", "disposed")).toBe(false);
    expect(canTransition("registered", "appealed")).toBe(false);
    expect(() => assertTransition("filed", "disposed")).toThrow(/INVALID_TRANSITION/);
  });

  it("isTerminal / deriveStage", () => {
    expect(isTerminal("disposed")).toBe(true);
    expect(isTerminal("appealed")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(deriveStage("reserved")).toBe("reserved");
  });
});

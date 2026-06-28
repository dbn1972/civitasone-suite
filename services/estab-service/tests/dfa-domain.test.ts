import { describe, it, expect } from "vitest";
import { canTransition, isEditable, nextDfaNo } from "../src/modules/dfa/domain.js";

describe("DFA state machine", () => {
  it("allows the happy path draft → … → dispatched", () => {
    expect(canTransition("draft", "pending_approval")).toBe(true);
    expect(canTransition("pending_approval", "approved")).toBe(true);
    expect(canTransition("approved", "signed")).toBe(true);
    expect(canTransition("signed", "dispatched")).toBe(true);
  });

  it("allows return and resubmit", () => {
    expect(canTransition("pending_approval", "returned")).toBe(true);
    expect(canTransition("returned", "pending_approval")).toBe(true);
  });

  it("blocks illegal jumps", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "dispatched")).toBe(false);
    expect(canTransition("approved", "dispatched")).toBe(false);
    expect(canTransition("dispatched", "draft")).toBe(false);
  });

  it("is editable only while draft or returned", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("returned")).toBe(true);
    expect(isEditable("pending_approval")).toBe(false);
    expect(isEditable("approved")).toBe(false);
    expect(isEditable("dispatched")).toBe(false);
  });

  it("generates a typed DFA number", () => {
    expect(nextDfaNo("letter")).toMatch(/^DFA\/LET\/\d{4}\/\d{4}$/);
    expect(nextDfaNo("order")).toMatch(/^DFA\/ORD\/\d{4}\/\d{4}$/);
  });
});

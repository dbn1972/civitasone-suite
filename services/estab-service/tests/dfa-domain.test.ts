import { describe, it, expect } from "vitest";
import { canTransition, isEditable, formatDfaNo } from "../src/modules/dfa/domain.js";

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

  it("formats a gapless, typed DFA number", () => {
    expect(formatDfaNo("letter", 2026, 1)).toBe("DFA/LET/2026/00001");
    expect(formatDfaNo("order", 2026, 42)).toBe("DFA/ORD/2026/00042");
    expect(formatDfaNo("notification", 2026, 12345)).toBe("DFA/NOT/2026/12345");
  });
});

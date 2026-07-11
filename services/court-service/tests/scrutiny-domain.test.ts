/** Pure-domain tests for the scrutiny + defect state machines and id derivation. */
import { describe, it, expect } from "vitest";
import {
  canScrutinyTransition, assertScrutinyTransition,
  canDefectTransition, assertDefectTransition,
  deriveScrutinyId, deriveDefectId,
} from "../src/modules/scrutiny/domain.js";

describe("scrutiny domain — scrutiny state machine", () => {
  it("a pending scrutiny can be cleared or marked defective", () => {
    expect(canScrutinyTransition("pending", "cleared")).toBe(true);
    expect(canScrutinyTransition("pending", "defective")).toBe(true);
  });

  it("a defective scrutiny can later be cleared", () => {
    expect(canScrutinyTransition("defective", "cleared")).toBe(true);
  });

  it("cleared is terminal and illegal jumps are rejected", () => {
    expect(canScrutinyTransition("cleared", "defective")).toBe(false);
    expect(canScrutinyTransition("cleared", "pending")).toBe(false);
    expect(canScrutinyTransition("defective", "pending")).toBe(false);
    expect(() => assertScrutinyTransition("cleared", "defective")).toThrow(/INVALID_SCRUTINY_TRANSITION/);
  });
});

describe("scrutiny domain — defect state machine", () => {
  it("a raised defect can be rectified, waived or rejected", () => {
    expect(canDefectTransition("raised", "rectified")).toBe(true);
    expect(canDefectTransition("raised", "waived")).toBe(true);
    expect(canDefectTransition("raised", "rejected")).toBe(true);
  });

  it("resolved states are terminal and illegal transitions are rejected", () => {
    expect(canDefectTransition("rectified", "waived")).toBe(false);
    expect(canDefectTransition("waived", "raised")).toBe(false);
    expect(() => assertDefectTransition("rectified", "waived")).toThrow(/INVALID_DEFECT_TRANSITION/);
  });
});

describe("scrutiny domain — id derivation", () => {
  const t = "11111111-1111-1111-1111-111111111111";
  const c = "22222222-2222-2222-2222-222222222222";

  it("deriveScrutinyId is deterministic per (tenant, case)", () => {
    expect(deriveScrutinyId(t, c)).toBe(deriveScrutinyId(t, c));
    expect(deriveScrutinyId(t, c)).not.toBe(deriveScrutinyId(t, "33333333-3333-3333-3333-333333333333"));
  });

  it("deriveDefectId is deterministic per (tenant, case, category, seq)", () => {
    expect(deriveDefectId(t, c, "missing_vakalatnama", 1)).toBe(deriveDefectId(t, c, "missing_vakalatnama", 1));
    expect(deriveDefectId(t, c, "missing_vakalatnama", 1)).not.toBe(deriveDefectId(t, c, "missing_vakalatnama", 2));
    expect(deriveDefectId(t, c, "missing_vakalatnama", 1)).not.toBe(deriveDefectId(t, c, "unpaid_court_fee", 1));
  });
});

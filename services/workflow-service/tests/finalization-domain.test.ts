/** CAP-029 — finalization/reversal guard pure domain. */
import { describe, it, expect } from "vitest";
import { assertEditable, isProtected, canReverse, assessImpact, type FinalizationState } from "../src/modules/finalization/domain.js";

function state(p: Partial<FinalizationState> = {}): FinalizationState {
  return {
    instanceId: "i1",
    finalized: true,
    finalizedBy: "u1",
    finalizedAt: "2025-01-01T00:00:00Z",
    reversed: false,
    reversedBy: null,
    reversedAt: null,
    ...p,
  };
}

describe("assertEditable / isProtected", () => {
  it("blocks edits on a finalized, un-reversed instance", () => {
    expect(assertEditable(state()).allowed).toBe(false);
    expect(isProtected(state())).toBe(true);
  });
  it("allows edits when not finalized or already reversed", () => {
    expect(assertEditable(null).allowed).toBe(true);
    expect(assertEditable(state({ reversed: true })).allowed).toBe(true);
    expect(isProtected(state({ reversed: true }))).toBe(false);
  });
});

describe("canReverse — authority + reason + dependency guards", () => {
  it("allows reversal when finalized, authorised, reasoned, and unblocked", () => {
    const r = canReverse({ state: state(), hasAuthority: true, reason: "audit correction", dependencies: [] });
    expect(r.allowed).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("blocks reversal without authority", () => {
    const r = canReverse({ state: state(), hasAuthority: false, reason: "x", dependencies: [] });
    expect(r.allowed).toBe(false);
    expect(r.errors).toContain("NO_REVERSAL_AUTHORITY");
  });
  it("blocks reversal without a reason", () => {
    const r = canReverse({ state: state(), hasAuthority: true, reason: "  ", dependencies: [] });
    expect(r.errors).toContain("REASON_REQUIRED");
  });
  it("blocks reversal when a blocking dependency exists", () => {
    const r = canReverse({
      state: state(), hasAuthority: true, reason: "x",
      dependencies: [{ type: "payment", id: "p1", blocking: true }],
    });
    expect(r.errors).toContain("BLOCKING_DEPENDENCIES");
  });
  it("collects multiple failures for a non-finalized, unauthorised request", () => {
    const r = canReverse({ state: state({ finalized: false }), hasAuthority: false, reason: "", dependencies: [] });
    expect(r.errors).toEqual(expect.arrayContaining(["NOT_FINALIZED", "NO_REVERSAL_AUTHORITY", "REASON_REQUIRED"]));
  });
  it("blocks a double reversal", () => {
    const r = canReverse({ state: state({ reversed: true }), hasAuthority: true, reason: "x", dependencies: [] });
    expect(r.errors).toContain("ALREADY_REVERSED");
  });
});

describe("assessImpact", () => {
  it("summarises dependents and reversibility", () => {
    const clean = assessImpact("i1", [{ type: "note", id: "n1", blocking: false }]);
    expect(clean.reversible).toBe(true);
    expect(clean.dependentCount).toBe(1);
    const blocked = assessImpact("i1", [{ type: "payment", id: "p1", blocking: true }]);
    expect(blocked.reversible).toBe(false);
    expect(blocked.blockingCount).toBe(1);
  });
});

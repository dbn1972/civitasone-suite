import { describe, it, expect } from "vitest";
import {
  RUN_TRANSITIONS, runActionDenial, runAcceptsComputation, assertRunStatusTransition, DomainError,
  RUN_NOT_READY_FOR_APPROVAL, RUN_ALREADY_APPROVED, RUN_NOT_READY_FOR_DISBURSEMENT, RUN_ALREADY_DISBURSED, RUN_NOT_REVERTIBLE,
} from "./domain.js";

/**
 * UAT L2-N3: a run used to be approvable while still "processing". The lifecycle
 * now has a distinct "computed" state (slips and totals written, awaiting
 * review) and runActionDenial is the single rule both the commands (409) and the
 * consumers (under the run lock) apply.
 */
const ALL = ["draft", "processing", "computed", "approved", "disbursed", "failed"];

describe("runActionDenial (UAT L2-N3)", () => {
  it("approve is allowed only from computed", () => {
    for (const s of ALL) {
      const d = runActionDenial("approve", s);
      if (s === "computed") expect(d).toBeNull();
      else expect(d, s).not.toBeNull();
    }
  });

  it("approve while processing says the run is still being computed", () => {
    const d = runActionDenial("approve", "processing");
    expect(d?.code).toBe(RUN_NOT_READY_FOR_APPROVAL);
    expect(d?.message).toMatch(/still being computed/);
  });

  it("approve on an approved or disbursed run is RUN_ALREADY_APPROVED; on draft/failed it is RUN_NOT_READY_FOR_APPROVAL", () => {
    expect(runActionDenial("approve", "approved")?.code).toBe(RUN_ALREADY_APPROVED);
    expect(runActionDenial("approve", "disbursed")?.code).toBe(RUN_ALREADY_APPROVED);
    expect(runActionDenial("approve", "draft")?.code).toBe(RUN_NOT_READY_FOR_APPROVAL);
    expect(runActionDenial("approve", "failed")?.code).toBe(RUN_NOT_READY_FOR_APPROVAL);
  });

  it("disburse is allowed only from approved", () => {
    for (const s of ALL) {
      const d = runActionDenial("disburse", s);
      if (s === "approved") expect(d).toBeNull();
      else if (s === "disbursed") expect(d?.code).toBe(RUN_ALREADY_DISBURSED);
      else expect(d?.code, s).toBe(RUN_NOT_READY_FOR_DISBURSEMENT);
    }
  });

  it("revert is allowed only from failed", () => {
    for (const s of ALL) {
      const d = runActionDenial("revert", s);
      if (s === "failed") expect(d).toBeNull();
      else expect(d?.code, s).toBe(RUN_NOT_REVERTIBLE);
    }
  });

  it("an unknown status is never allowed", () => {
    expect(runActionDenial("approve", "mystery")?.code).toBe(RUN_NOT_READY_FOR_APPROVAL);
    expect(runActionDenial("disburse", "mystery")?.code).toBe(RUN_NOT_READY_FOR_DISBURSEMENT);
    expect(runActionDenial("revert", "mystery")?.code).toBe(RUN_NOT_REVERTIBLE);
  });

  it("agrees with the transition map: every allowed action is an allowed transition", () => {
    const target = { approve: "approved", disburse: "disbursed", revert: "draft" } as const;
    for (const s of ALL) {
      for (const a of ["approve", "disburse", "revert"] as const) {
        if (runActionDenial(a, s) === null) expect(() => assertRunStatusTransition(s, target[a])).not.toThrow();
        else if (!(RUN_TRANSITIONS[s] ?? []).includes(target[a])) expect(() => assertRunStatusTransition(s, target[a])).toThrow(DomainError);
      }
    }
  });
});

describe("runAcceptsComputation", () => {
  it("a computation pass may only write into a processing run or resume a computed one", () => {
    expect(runAcceptsComputation("processing")).toBe(true);
    expect(runAcceptsComputation("computed")).toBe(true);
    for (const s of ["draft", "approved", "disbursed", "failed", "mystery"]) expect(runAcceptsComputation(s), s).toBe(false);
  });
});

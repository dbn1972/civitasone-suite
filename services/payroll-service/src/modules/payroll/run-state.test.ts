import { describe, it, expect } from "vitest";
import {
  RUN_TRANSITIONS, runActionDenial, runAcceptsComputation, assertRunStatusTransition, DomainError,
  RUN_NOT_READY_FOR_APPROVAL, RUN_ALREADY_APPROVED, RUN_NOT_READY_FOR_DISBURSEMENT, RUN_ALREADY_DISBURSED, RUN_NOT_REVERTIBLE,
  RUN_NOT_REJECTABLE, RUN_NOT_PROCESSING, RUN_NOT_STUCK, stuckRunHours, DEFAULT_STUCK_RUN_HOURS,
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

describe("send back and stuck-run recovery (UAT L2-N3 review)", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("reject is allowed only from computed, and computed -> failed is a transition", () => {
    for (const s of ALL) {
      const d = runActionDenial("reject", s);
      if (s === "computed") expect(d).toBeNull();
      else expect(d?.code, s).toBe(RUN_NOT_REJECTABLE);
    }
    expect(() => assertRunStatusTransition("computed", "failed")).not.toThrow();
  });

  it("fail-stuck needs a processing run idle for at least the threshold", () => {
    expect(runActionDenial("failStuck", "processing", { updatedAt: hoursAgo(7), now, hours: 6 })).toBeNull();
    expect(runActionDenial("failStuck", "processing", { updatedAt: hoursAgo(6), now, hours: 6 })).toBeNull();
    expect(runActionDenial("failStuck", "processing", { updatedAt: hoursAgo(5.9), now, hours: 6 })?.code).toBe(RUN_NOT_STUCK);
    expect(runActionDenial("failStuck", "processing")?.code).toBe(RUN_NOT_STUCK);
    for (const s of ALL.filter((x) => x !== "processing")) {
      expect(runActionDenial("failStuck", s, { updatedAt: hoursAgo(100), now, hours: 6 })?.code, s).toBe(RUN_NOT_PROCESSING);
    }
  });

  it("the threshold comes from PAYROLL_STUCK_RUN_HOURS, default 6", () => {
    expect(stuckRunHours({})).toBe(DEFAULT_STUCK_RUN_HOURS);
    expect(DEFAULT_STUCK_RUN_HOURS).toBe(6);
    expect(stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: "2" })).toBe(2);
    expect(stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: "-1" })).toBe(DEFAULT_STUCK_RUN_HOURS);
    expect(stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: "x" })).toBe(DEFAULT_STUCK_RUN_HOURS);
  });
});

describe("runAcceptsComputation", () => {
  it("a computation pass may only write into a processing run or resume a computed one", () => {
    expect(runAcceptsComputation("processing")).toBe(true);
    expect(runAcceptsComputation("computed")).toBe(true);
    for (const s of ["draft", "approved", "disbursed", "failed", "mystery"]) expect(runAcceptsComputation(s), s).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  computeChangeOrder, nextSeq, assertAmendmentTransition, assertMilestoneTransition,
  assertDistinctMakerChecker, assertPoAmendable, assertClosable, AmendmentDomainError,
} from "../src/modules/po/amendment-domain.js";

describe("SVC-046 PO amendment domain — change-order versioning", () => {
  it("applies a positive delta to the PO total", () => {
    const r = computeChangeOrder(1000000n, 250000n);
    expect(r.prevTotalMinor).toBe(1000000n);
    expect(r.deltaMinor).toBe(250000n);
    expect(r.newTotalMinor).toBe(1250000n);
  });

  it("applies a negative delta (scope reduction)", () => {
    const r = computeChangeOrder(1000000n, -400000n);
    expect(r.newTotalMinor).toBe(600000n);
  });

  it("rejects a delta that would make the total negative", () => {
    expect(() => computeChangeOrder(100n, -500n)).toThrow(/NEGATIVE_TOTAL/);
  });

  it("uses exact bigint arithmetic beyond 2^53", () => {
    const r = computeChangeOrder(9_000_000_000_000_000n, 1_000_000_000_000_000n);
    expect(r.newTotalMinor).toBe(10_000_000_000_000_000n);
  });

  it("nextSeq increments amendment/milestone numbers monotonically from 0", () => {
    expect(nextSeq(0)).toBe(1);
    expect(nextSeq(3)).toBe(4);
    expect(nextSeq(null)).toBe(1);
    expect(nextSeq(undefined)).toBe(1);
  });
});

describe("SVC-046 PO amendment domain — status machines + SoD", () => {
  it("amendment: pending -> approved / rejected only", () => {
    expect(() => assertAmendmentTransition("pending", "approved")).not.toThrow();
    expect(() => assertAmendmentTransition("pending", "rejected")).not.toThrow();
    expect(() => assertAmendmentTransition("approved", "rejected")).toThrow(AmendmentDomainError);
  });

  it("milestone: pending -> delivered -> closed", () => {
    expect(() => assertMilestoneTransition("pending", "delivered")).not.toThrow();
    expect(() => assertMilestoneTransition("delivered", "closed")).not.toThrow();
    expect(() => assertMilestoneTransition("closed", "in_progress")).toThrow();
  });

  it("rejects amendment self-approval (maker === checker)", () => {
    expect(() => assertDistinctMakerChecker("u1", "u1")).toThrow(/SOD_VIOLATION/);
    expect(() => assertDistinctMakerChecker("u1", "u2")).not.toThrow();
  });

  it("only approved/dispatched/gem_placed POs are amendable", () => {
    expect(() => assertPoAmendable("approved")).not.toThrow();
    expect(() => assertPoAmendable("dispatched")).not.toThrow();
    expect(() => assertPoAmendable("draft")).toThrow(/PO_NOT_AMENDABLE/);
    expect(() => assertPoAmendable("closed")).toThrow(/PO_NOT_AMENDABLE/);
  });
});

describe("SVC-046 PO closure guard", () => {
  it("closes when all milestones are terminal", () => {
    expect(() => assertClosable("dispatched", ["delivered", "closed"])).not.toThrow();
    expect(() => assertClosable("approved", [])).not.toThrow();
  });

  it("blocks closure with open milestones", () => {
    expect(() => assertClosable("dispatched", ["delivered", "in_progress"])).toThrow(/MILESTONES_OPEN/);
    expect(() => assertClosable("dispatched", ["pending"])).toThrow(/MILESTONES_OPEN/);
  });

  it("blocks closure from a non-closable PO status", () => {
    expect(() => assertClosable("draft", [])).toThrow(/PO_NOT_CLOSABLE/);
    expect(() => assertClosable("closed", [])).toThrow(/PO_NOT_CLOSABLE/);
  });
});

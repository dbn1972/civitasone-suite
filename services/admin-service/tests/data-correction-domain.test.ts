/**
 * CAP-100 — unit tests for data-correction governance guards.
 */
import { describe, it, expect } from "vitest";
import {
  DataCorrectionError,
  assertCorrectionApproverDistinct,
  assertCorrectionPending,
  assertJustification,
} from "../src/modules/support/domain.js";

describe("data-correction maker-checker", () => {
  it("rejects self-approval", () => {
    try { assertCorrectionApproverDistinct("u1", "u1"); throw new Error("no throw"); }
    catch (e) { expect(e).toBeInstanceOf(DataCorrectionError); expect((e as DataCorrectionError).code).toBe("MAKER_CHECKER_VIOLATION"); }
  });
  it("allows a distinct approver", () => {
    expect(() => assertCorrectionApproverDistinct("u1", "u2")).not.toThrow();
  });
});

describe("assertCorrectionPending", () => {
  it("passes for pending", () => expect(() => assertCorrectionPending("pending")).not.toThrow());
  it.each(["approved", "rejected"])("throws for %s", (st) => {
    try { assertCorrectionPending(st); throw new Error("no throw"); }
    catch (e) { expect((e as DataCorrectionError).code).toBe("NOT_PENDING"); }
  });
});

describe("assertJustification", () => {
  it("passes for a sufficient justification", () => expect(() => assertJustification("Fixing a typo in the citizen name field")).not.toThrow());
  it.each([null, undefined, "", "  ", "too short"])("throws for %p", (j) => {
    try { assertJustification(j as string); throw new Error("no throw"); }
    catch (e) { expect(e).toBeInstanceOf(DataCorrectionError); expect((e as DataCorrectionError).code).toBe("JUSTIFICATION_REQUIRED"); }
  });
});

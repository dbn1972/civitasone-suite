import { describe, it, expect } from "vitest";
import { MAKER_CHECKER_MESSAGES, MAKER_CHECKER_VIOLATION, runMakerCheckerDenial } from "./run-maker-checker.js";

// GAP-PAYROLL-DETAIL-02: the pure maker-checker rules for the payroll run lifecycle.
const MAKER = "11111111-1111-4111-8111-111111111111";
const CHECKER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

describe("runMakerCheckerDenial", () => {
  it("exposes the stable error code the API and the web catalogue share", () => {
    expect(MAKER_CHECKER_VIOLATION).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("approve: the person who created the run may not approve it", () => {
    expect(runMakerCheckerDenial("approve", MAKER, { createdBy: MAKER, approvedBy: null })).toBe(MAKER_CHECKER_MESSAGES.approve);
  });

  it("approve: anyone else may", () => {
    expect(runMakerCheckerDenial("approve", CHECKER, { createdBy: MAKER, approvedBy: null })).toBeNull();
  });

  it("disburse: the person who approved the run may not disburse it", () => {
    expect(runMakerCheckerDenial("disburse", CHECKER, { createdBy: MAKER, approvedBy: CHECKER })).toBe(MAKER_CHECKER_MESSAGES.disburse);
  });

  it("disburse: the creator may disburse (two distinct people are enough: A creates and disburses, B approves)", () => {
    expect(runMakerCheckerDenial("disburse", MAKER, { createdBy: MAKER, approvedBy: CHECKER })).toBeNull();
  });

  it("disburse: a third person may", () => {
    expect(runMakerCheckerDenial("disburse", THIRD, { createdBy: MAKER, approvedBy: CHECKER })).toBeNull();
  });

  it("disburse: a run with no recorded approver has nobody to compare against, so the rule cannot fire", () => {
    expect(runMakerCheckerDenial("disburse", CHECKER, { createdBy: MAKER, approvedBy: null })).toBeNull();
  });

  it("approve: a run with no recorded creator cannot match the actor", () => {
    expect(runMakerCheckerDenial("approve", MAKER, { createdBy: null, approvedBy: null })).toBeNull();
  });
});

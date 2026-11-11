/**
 * UAT T-EDGE bundle 21 (TE-01 / TE-07, S01-S04): a salary revision effective date must be a real
 * calendar date, at most 5 years back and 1 year ahead (env-configurable). 29 Feb 2027 / 31 Apr
 * were 202-accepted and dropped by the worker; 1990 / 2099 revisions were stored pending.
 * Schema-level (the route parses the body with this schema before anything is queued).
 */
import { describe, it, expect } from "vitest";
import { createSalaryRevisionBody } from "../src/modules/payroll/validators.js";
import { istToday, addYears } from "@civitasone/schemas/validators";

const base = {
  employeeId: "6f1c2d3e-4b5a-4c6d-8e7f-901234567890", effectiveDate: istToday(),
  oldBasicMinor: 5000000, newBasicMinor: 5200000, oldGrossMinor: 6000000, newGrossMinor: 6200000,
  orderNo: "ORD/B21/1",
};
const code = (effectiveDate: string) => {
  const r = createSalaryRevisionBody.safeParse({ ...base, effectiveDate });
  if (r.success) return undefined;
  const issue = r.error.issues.find((i) => i.path.join(".") === "effectiveDate") as { params?: { code?: string } } | undefined;
  return issue?.params?.code;
};

describe("salary revision effective date (TE-01/07)", () => {
  it.each([["S01", "2027-02-29", "DATE_INVALID"], ["S02", "2026-04-31", "DATE_INVALID"], ["S03", "1990-01-01", "DATE_TOO_EARLY"], ["S04", "2099-01-01", "DATE_TOO_LATE"]])("%s %s -> %s", (_id, d, c) => {
    expect(code(d)).toBe(c);
  });
  it("accepts today, 5 years back and 1 year ahead", () => {
    expect(code(istToday())).toBeUndefined();
    expect(code(addYears(istToday(), -5))).toBeUndefined();
    expect(code(addYears(istToday(), 1))).toBeUndefined();
  });
});

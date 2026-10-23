import { describe, it, expect } from "vitest";
import { createSalaryRevisionBody } from "./validators.js";

// GAP-PAYROLL-SALARY-REVISIONS-02: a revision rewrites HRMS basic pay, so the
// API itself (not just the form) requires the sanctioning order number.
const base = {
  employeeId: "7c1d2e3f-0000-4000-8000-00000000a754",
  effectiveDate: "2026-08-01",
  oldBasicMinor: 4000000,
  newBasicMinor: 4400000,
  oldGrossMinor: 8000000,
  newGrossMinor: 8800000,
  revisionType: "annual_increment" as const,
};

describe("createSalaryRevisionBody orderNo", () => {
  it("rejects a missing, empty or whitespace-only order number", () => {
    expect(createSalaryRevisionBody.safeParse(base).success).toBe(false);
    expect(createSalaryRevisionBody.safeParse({ ...base, orderNo: "" }).success).toBe(false);
    expect(createSalaryRevisionBody.safeParse({ ...base, orderNo: "   " }).success).toBe(false);
  });
  it("accepts and trims a real order number", () => {
    const r = createSalaryRevisionBody.safeParse({ ...base, orderNo: "  ORD/2026/17 " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.orderNo).toBe("ORD/2026/17");
  });
});

// GAP-PAYROLL-SALARY-REVISIONS-02: the maker's reason (audited) -- optional on the API, but a real sentence when sent.
describe("createSalaryRevisionBody reason", () => {
  const withOrder = { ...base, orderNo: "ORD/2026/17" };
  it("is optional (older clients and scripts keep working)", () => {
    expect(createSalaryRevisionBody.safeParse(withOrder).success).toBe(true);
  });
  it("rejects a reason shorter than 10 characters, a blank one, or one over 512", () => {
    expect(createSalaryRevisionBody.safeParse({ ...withOrder, reason: "too short" }).success).toBe(false);
    expect(createSalaryRevisionBody.safeParse({ ...withOrder, reason: "            " }).success).toBe(false);
    expect(createSalaryRevisionBody.safeParse({ ...withOrder, reason: "x".repeat(513) }).success).toBe(false);
  });
  it("accepts and trims a real reason", () => {
    const r = createSalaryRevisionBody.safeParse({ ...withOrder, reason: "  Sanctioned per order ORD/2026/17  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("Sanctioned per order ORD/2026/17");
  });
});


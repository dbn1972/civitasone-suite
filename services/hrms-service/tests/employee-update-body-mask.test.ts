/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-02: PATCH /v1/hrms/employees/:id must never
 * carry an asterisk in mobile / bankAccountNo / bankIfsc. GET masks those
 * fields ("******7890"); a client echoing one back -- untouched or half-edited
 * -- would otherwise overwrite the stored value (the account number feeds
 * salary disbursement). Also pins the employee list query's new
 * excludeStatuses filter (GAP-HR-EMPLOYEES-DETAIL-EDIT-05).
 */
import { describe, it, expect } from "vitest";
import { updateEmployeeBody, employeeListQuery } from "../src/modules/employee/validators.js";

describe("updateEmployeeBody -- masked placeholders are rejected at the boundary", () => {
  it.each([
    ["bankAccountNo", "******7890"],
    ["bankAccountNo", "1234*67890"],
    ["mobile", "******3210"],
    ["mobile", "98765*3210"],
    ["bankIfsc", "HDFC*001234"],
  ])("rejects %s = %s with a field-level error", (field, value) => {
    const r = updateEmployeeBody.safeParse({ [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual([field]);
      expect(r.error.issues[0]!.message).toMatch(/masked placeholder/);
    }
  });

  it("accepts real values for the same fields", () => {
    const r = updateEmployeeBody.safeParse({ bankAccountNo: "000999888777", mobile: "9876543210", bankIfsc: "HDFC0001234", email: "a@example.gov.in" });
    expect(r.success).toBe(true);
  });

  it("still allows an email-only patch (nothing sensitive, nothing masked)", () => {
    expect(updateEmployeeBody.safeParse({ email: "new@example.gov.in" }).success).toBe(true);
  });
});

describe("employeeListQuery -- limit and excludeStatuses", () => {
  it("accepts limit 500 and rejects 501", () => {
    expect(employeeListQuery.safeParse({ limit: "500" }).success).toBe(true);
    expect(employeeListQuery.safeParse({ limit: "501" }).success).toBe(false);
  });

  it("parses excludeStatuses into a trimmed list of canonical statuses", () => {
    const r = employeeListQuery.parse({ excludeStatuses: "terminated, separated ,retired" });
    expect(r.excludeStatuses).toEqual(["terminated", "separated", "retired"]);
  });

  it("leaves excludeStatuses undefined when absent", () => {
    expect(employeeListQuery.parse({}).excludeStatuses).toBeUndefined();
  });

  it("rejects an unknown status instead of silently ignoring it", () => {
    expect(employeeListQuery.safeParse({ excludeStatuses: "separated,bogus" }).success).toBe(false);
    expect(employeeListQuery.safeParse({ excludeStatuses: "active" }).success).toBe(false);
  });
});

describe("updateEmployeeBody -- same statutory validation as create (PR #2465 review SF2)", () => {
  it.each([
    ["mobile", "12345"],
    ["bankIfsc", "NOTANIFSC"],
    ["uanNumber", "12345"],
    ["gstin", "27AAPFU0939F1ZX"],
  ])("rejects an invalid %s = %s on PATCH, so create-then-PATCH cannot bypass TE-05", (field, value) => {
    const r = updateEmployeeBody.safeParse({ [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual([field]);
  });

  it("accepts valid values and stores the normalised form", () => {
    const r = updateEmployeeBody.safeParse({ mobile: "+91 98765 43210", bankIfsc: "hdfc0001234", uanNumber: "123456789012", gstin: "27aapfu0939f1zv" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ mobile: "9876543210", bankIfsc: "HDFC0001234", uanNumber: "123456789012", gstin: "27AAPFU0939F1ZV" });
  });
});

describe("updateEmployeeBody -- blank clears an optional identifier (EditEmployeeForm), bad values still fail", () => {
  it.each(["mobile", "bankIfsc", "uanNumber"])("%s: \"\" (and whitespace) becomes null so the field can be cleared", (field) => {
    for (const blank of ["", "   "]) {
      const r = updateEmployeeBody.safeParse({ [field]: blank });
      expect(r.success).toBe(true);
      if (r.success) expect((r.data as Record<string, unknown>)[field]).toBeNull();
    }
  });
  it.each([["mobile", "12345"], ["bankIfsc", "NOTANIFSC"], ["uanNumber", "12345"]])("%s: a non-empty bad value is still rejected", (field, value) => {
    expect(updateEmployeeBody.safeParse({ [field]: value }).success).toBe(false);
  });
  it("omitted stays undefined (not cleared)", () => {
    const r = updateEmployeeBody.parse({ email: "a@example.gov.in" });
    expect(r.mobile).toBeUndefined();
    expect(r.bankIfsc).toBeUndefined();
    expect(r.uanNumber).toBeUndefined();
  });
});

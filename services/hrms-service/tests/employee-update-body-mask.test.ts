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

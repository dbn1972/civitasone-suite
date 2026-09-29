/**
 * CAP-085 adoption proof — hrms-service consumes @civitasone/data-governance
 * (Aadhaar-only slice; see src/shared/data-governance.ts for scope notes).
 * Mirrors services/crm-service/tests/data-governance-adoption.test.ts and
 * services/citizen-service/tests/data-governance-adoption.test.ts.
 */
import { describe, it, expect } from "vitest";
import { EMPLOYEE_MASKING_POLICY, EMPLOYEE_PII_ROLES, maskEmployeeRecord } from "../src/shared/data-governance.js";

describe("hrms-service data-governance adoption (Aadhaar)", () => {
  const employee = { id: "emp-1", fullName: "Ravi Kumar", aadhaarRef: "123456789012" };

  it("masks aadhaarRef for non-privileged roles (last 4 digits visible, UIDAI convention)", () => {
    const masked = maskEmployeeRecord(employee, ["employee"]);
    expect(masked.fullName).toBe("Ravi Kumar"); // not in policy → untouched
    expect(masked.aadhaarRef).toBe("********9012");
  });

  it("reveals aadhaarRef to privileged HR roles", () => {
    const raw = maskEmployeeRecord(employee, EMPLOYEE_PII_ROLES);
    expect(raw.aadhaarRef).toBe("123456789012");
  });

  it("reveals aadhaarRef individually for each privileged role (hr_admin / hr_officer / super_admin)", () => {
    expect(maskEmployeeRecord(employee, ["hr_admin"]).aadhaarRef).toBe("123456789012");
    expect(maskEmployeeRecord(employee, ["hr_officer"]).aadhaarRef).toBe("123456789012");
    expect(maskEmployeeRecord(employee, ["super_admin"]).aadhaarRef).toBe("123456789012");
  });

  it("does NOT reveal aadhaarRef to a plain manager (READER_ROLES member, but not HR-privileged)", () => {
    const masked = maskEmployeeRecord(employee, ["manager"]);
    expect(masked.aadhaarRef).toBe("********9012");
  });

  it("defaults to fully masked with no roles", () => {
    expect(maskEmployeeRecord(employee).aadhaarRef).toBe("********9012");
  });

  it("leaves aadhaarRef alone when absent from the record", () => {
    const noAadhaar = { id: "emp-2", fullName: "No Aadhaar On File" };
    expect(maskEmployeeRecord(noAadhaar, ["employee"])).toEqual(noAadhaar);
  });

  it("policy declares exactly one rule: aadhaarRef (scope is Aadhaar-only, this PR)", () => {
    expect(Object.keys(EMPLOYEE_MASKING_POLICY)).toEqual(["aadhaarRef"]);
  });
});

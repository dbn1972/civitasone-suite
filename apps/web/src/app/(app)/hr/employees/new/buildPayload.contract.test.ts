import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPayload } from "./AddEmployeeWizard";
import { WIZARD_INIT, type WizardData } from "./wizardTypes";

// GAP-HR-EMPLOYEES-NEW-01 contract: every key the wizard sends must be a key
// createEmployeeBody accepts. zod strips unknown keys silently, which is how
// grade/shift/maritalStatus/bloodGroup/costCenter used to vanish. The web app
// cannot import the service package, so read its source and compare.
const VALIDATORS = join(process.cwd(), "../../services/hrms-service/src/modules/employee/validators.ts");

function createBodyKeys(): Set<string> {
  const src = readFileSync(VALIDATORS, "utf8");
  const start = src.indexOf("export const createEmployeeBody = z.object({");
  const end = src.indexOf("export type CreateEmployeeBody", start);
  if (start < 0 || end < 0) throw new Error("createEmployeeBody not found");
  const block = src.slice(start, end);
  return new Set([...block.matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1]!));
}

const FULL: WizardData = {
  ...WIZARD_INIT,
  fullName: "Priya Sharma", dateOfBirth: "1990-04-02", gender: "female", maritalStatus: "married", bloodGroup: "O+",
  mobile: "9876543210", email: "priya@example.gov.in", employeeNo: "E-1", departmentId: "d1", designationId: "g1",
  grade: "Group-B", dateOfJoining: "2026-01-01", employeeType: "permanent", basicPay: "44900.50",
  managerId: "m1", workLocation: "Delhi", locationId: "loc-1", shift: "morning", costCenterId: "cc1", workStateCode: "MH",
  pan: "ABCDE1234F", aadhaarRef: "ref", bankAccountNo: "1234567890", bankIfsc: "SBIN0001234",
};

describe("AddEmployeeWizard buildPayload contract", () => {
  it("emits only keys createEmployeeBody accepts", () => {
    const accepted = createBodyKeys();
    const sent = Object.keys(buildPayload(FULL));
    expect(sent.filter((k) => !accepted.has(k))).toEqual([]);
  });

  it("sends the previously dropped fields under their real keys", () => {
    const body = buildPayload(FULL);
    expect(body).toMatchObject({
      serviceGrade: "Group-B", maritalStatus: "married", bloodGroup: "O+", shift: "morning", costCenterId: "cc1",
      station: "Delhi", locationId: "loc-1", basicMinor: 4490050,
    });
    // the old free-text / wrong-key names must be gone
    for (const gone of ["grade", "costCenter", "workLocation", "pfEnrolled", "esiEnrolled", "ptApplicable"]) {
      expect(body).not.toHaveProperty(gone);
    }
  });

  it("sends a real state / UT code as workStateCode and drops a blank or unknown one", () => {
    expect(buildPayload(FULL)).toMatchObject({ workStateCode: "MH" });
    expect(buildPayload({ ...FULL, workStateCode: "" })).not.toHaveProperty("workStateCode");
    expect(buildPayload({ ...FULL, workStateCode: "ZZ" })).not.toHaveProperty("workStateCode");
  });

  it("omits blank optional fields instead of sending empty strings (which would fail the enums)", () => {
    const body = buildPayload({ ...FULL, maritalStatus: "", bloodGroup: "", shift: "", costCenterId: "", grade: "" });
    for (const k of ["maritalStatus", "bloodGroup", "shift", "costCenterId", "serviceGrade"]) expect(body).not.toHaveProperty(k);
  });

  it("the wizard's closed value sets match the service enums", () => {
    const src = readFileSync(VALIDATORS, "utf8");
    const set = (name: string) => [...new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(set("MARITAL_STATUSES")).toEqual(["single", "married", "divorced", "widowed"]);
    expect(set("SHIFTS")).toEqual(["general", "morning", "evening", "night"]);
    expect(set("BLOOD_GROUPS")).toEqual(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]);
  });
});

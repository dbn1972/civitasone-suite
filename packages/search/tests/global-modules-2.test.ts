import { describe, it, expect } from "vitest";
import { entityTypesForRoles, buildGlobalDocument, hrefForEntity, findSensitive } from "../src/global/index.js";

const T = "11111111-1111-4111-8111-111111111111";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("permissions: contracts, meetings, establishment files, citizen applications", () => {
  it("an employee and the applicant's own citizen role see none of the new types", () => {
    expect(entityTypesForRoles(["employee"])).toEqual([]);
    expect(entityTypesForRoles(["citizen"])).toEqual([]);
  });
  it("each owning-module role sees only its own new type", () => {
    expect(entityTypesForRoles(["citizen_officer"])).toEqual(["citizen.application"]);
    expect(entityTypesForRoles(["estab_officer"])).toEqual(["estab.file"]);
    expect(entityTypesForRoles(["committee_member"])).toEqual(["meeting.meeting"]);
    expect(entityTypesForRoles(["meeting_admin"])).toEqual(["meeting.meeting"]);
  });
  it("contracts are readable by procurement/finance admin and audit, not by plain finance_officer or hr", () => {
    expect(entityTypesForRoles(["finance_admin"])).toContain("contracts.contract");
    expect(entityTypesForRoles(["audit_officer"])).toContain("contracts.contract");
    expect(entityTypesForRoles(["finance_officer"])).not.toContain("contracts.contract");
    expect(entityTypesForRoles(["hr_admin"])).not.toContain("contracts.contract");
  });
  it("finance and hr roles do not see citizen applications, meetings or files", () => {
    for (const r of ["finance_admin", "hr_admin", "procurement_admin"]) {
      const t = entityTypesForRoles([r]);
      expect(t).not.toContain("citizen.application");
      expect(t).not.toContain("meeting.meeting");
      expect(t).not.toContain("estab.file");
    }
  });
});

describe("links and personal data", () => {
  it("record links are same-origin paths", () => {
    expect(hrefForEntity("contracts.contract", E)).toBe(`/contracts/${E}`);
    expect(hrefForEntity("meeting.meeting", E)).toBe(`/meeting/meetings/${E}`);
    expect(hrefForEntity("estab.file", E)).toBe(`/estab/files/${E}`);
    expect(hrefForEntity("citizen.application", E, "APP/2026/0001")).toBe("/citizen/services?application=APP%2F2026%2F0001");
  });
  it("an applicant's PAN, Aadhaar, mobile or e-mail that slips into any field is redacted", () => {
    const { doc, redactions } = buildGlobalDocument({
      entityType: "citizen.application", entityId: E, tenantId: T, title: "Application APP/1 ABCDE1234F", refNumber: "APP/1",
      status: "submitted", summary: "Birth certificate 2345 6789 0123 9876543210 a@b.in",
    });
    expect(redactions).toBeGreaterThanOrEqual(4);
    expect(findSensitive(JSON.stringify([doc.title, doc.refNumber, doc.status, doc.summary]))).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { buildSettingsBody, isValidEmblemUrl, toForm } from "./settingsForm";

const form = { organisationName: "", departmentName: "", emblemUrl: "", offerWorkflowRequired: true, applicantPurposeNote: "" };

describe("settings form", () => {
  it("blank text fields clear the setting (null) and the policy flag is always sent", () => {
    expect(buildSettingsBody(form)).toEqual({ ok: true, body: { organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null } });
  });
  it("trims text and keeps the values", () => {
    const r = buildSettingsBody({ ...form, organisationName: "  Government of Odisha ", emblemUrl: " https://x.gov.in/e.png ", offerWorkflowRequired: false });
    expect(r).toEqual({ ok: true, body: { organisationName: "Government of Odisha", departmentName: null, emblemUrl: "https://x.gov.in/e.png", offerWorkflowRequired: false, applicantPurposeNote: null } });
  });
  it("only an https URL or a site path is an emblem", () => {
    expect(isValidEmblemUrl("https://x/e.png")).toBe(true);
    expect(isValidEmblemUrl("/static/e.svg")).toBe(true);
    for (const bad of ["http://x/e.png", "javascript:alert(1)", "//evil/e.png", "data:image/png;base64,AA"]) expect(isValidEmblemUrl(bad), bad).toBe(false);
    expect(buildSettingsBody({ ...form, emblemUrl: "javascript:alert(1)" })).toEqual({ ok: false, error: "emblemUrl" });
  });
  it("rejects over-long text (the service caps 200 / 2000)", () => {
    expect(buildSettingsBody({ ...form, organisationName: "x".repeat(201) })).toEqual({ ok: false, error: "organisationName" });
    expect(buildSettingsBody({ ...form, applicantPurposeNote: "x".repeat(2001) })).toEqual({ ok: false, error: "applicantPurposeNote" });
  });
  it("toForm maps nulls to empty strings", () => {
    expect(toForm({ organisationName: null, departmentName: "D", emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null })).toEqual({ ...form, departmentName: "D" });
  });
});

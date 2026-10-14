import { describe, expect, it } from "vitest";
import { validateFollowUp } from "./followUpSchema";

const ok = { citizenName: "Suresh Rao", citizenPhone: "", serviceType: "Renewal Support", subject: "Follow up", description: "" };

describe("validateFollowUp (mirrors crm-service service-request createBody)", () => {
  it("accepts a minimal valid request (phone/description optional)", () => {
    expect(validateFollowUp(ok)).toEqual({});
  });
  it("flags missing required fields", () => {
    const e = validateFollowUp({ ...ok, citizenName: " ", serviceType: "", subject: "" });
    expect(Object.keys(e).sort()).toEqual(["citizenName", "serviceType", "subject"]);
  });
  it("flags a too-short phone and over-long subject", () => {
    const e = validateFollowUp({ ...ok, citizenPhone: "12", subject: "x".repeat(501) });
    expect(e.citizenPhone).toBeTruthy();
    expect(e.subject).toMatch(/500/);
  });
});

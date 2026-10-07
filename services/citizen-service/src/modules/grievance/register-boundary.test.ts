import { describe, it, expect } from "vitest";
import { registerGrievanceBody } from "./validators.js";

describe("GAP-CITIZEN-GRIEVANCES-NEW-01/02/04 — register grievance boundary", () => {
  const base = { category: "service_delivery", subject: "No water", description: "No supply for 5 days" };

  it("accepts a structured DPDP consent object (not stripped as unknown)", () => {
    const parsed = registerGrievanceBody.parse({
      ...base,
      dpdpConsent: { given: true, noticeVersion: "2023.1", purpose: "grievance_redressal" },
    });
    expect(parsed.dpdpConsent).toEqual({ given: true, noticeVersion: "2023.1", purpose: "grievance_redressal" });
  });

  it("accepts an optional complainant name and contact channels", () => {
    const parsed = registerGrievanceBody.parse({
      ...base,
      complainantName: "Ramesh Kumar",
      complainantContact: [
        { kind: "mobile", value: "9876543210" },
        { kind: "email", value: "ramesh@example.com" },
      ],
    });
    expect(parsed.complainantName).toBe("Ramesh Kumar");
    expect(parsed.complainantContact).toHaveLength(2);
    expect(parsed.complainantContact?.[0]).toEqual({ kind: "mobile", value: "9876543210" });
  });

  it("rejects an invalid contact kind", () => {
    expect(() =>
      registerGrievanceBody.parse({ ...base, complainantContact: [{ kind: "fax", value: "123" }] }),
    ).toThrow();
  });

  it("keeps the new fields optional (backward compatible)", () => {
    const parsed = registerGrievanceBody.parse(base);
    expect(parsed.dpdpConsent).toBeUndefined();
    expect(parsed.complainantContact).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { buildContactPatch, isEmptyPatch, type ContactFormFields } from "./contactPatch";

const base: ContactFormFields = {
  name: "Asha Rao",
  email: "a@b.c",
  phone: "9900000000",
  company: "Acme",
  designation: "Director",
  city: "Bengaluru",
};

describe("buildContactPatch (GAP-CRM-CONTACTS-DETAIL-EDIT-01)", () => {
  it("maps a cleared email to explicit null (DPDP correction/erasure)", () => {
    const patch = buildContactPatch(base, { ...base, email: "" });
    expect(patch).toEqual({ email: null });
  });

  it("sends an empty patch when nothing changed", () => {
    const patch = buildContactPatch(base, base);
    expect(patch).toEqual({});
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it("emits only the changed field", () => {
    const patch = buildContactPatch(base, { ...base, city: "Mumbai" });
    expect(patch).toEqual({ city: "Mumbai" });
  });

  it("clears several fields at once with null", () => {
    const patch = buildContactPatch(base, { ...base, phone: "", company: "", city: "" });
    expect(patch).toEqual({ phone: null, company: null, city: null });
  });

  it("treats whitespace-only as cleared (null), not as a value", () => {
    const patch = buildContactPatch(base, { ...base, designation: "   " });
    expect(patch).toEqual({ designation: null });
  });

  it("does not re-send an already-empty field (initial null, form empty)", () => {
    const patch = buildContactPatch({ ...base, email: undefined }, { ...base, email: "" });
    expect(patch).toEqual({});
  });

  it("updates the name when changed, never nulls it", () => {
    const patch = buildContactPatch(base, { ...base, name: "Asha K Rao" });
    expect(patch).toEqual({ name: "Asha K Rao" });
  });

  it("ignores a blanked name (name is required, never cleared)", () => {
    const patch = buildContactPatch(base, { ...base, name: "" });
    expect(patch.name).toBeUndefined();
  });

  it("never includes leadStatus or marketingConsent (governance / separate controls)", () => {
    const patch = buildContactPatch(base, { ...base, city: "Pune" });
    expect(patch).not.toHaveProperty("leadStatus");
    expect(patch).not.toHaveProperty("marketingConsent");
  });
});

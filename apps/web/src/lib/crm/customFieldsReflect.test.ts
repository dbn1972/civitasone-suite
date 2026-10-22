import { describe, it, expect } from "vitest";
import { fieldReflectsDraft, toDraft, type CustomField } from "./customFields";

const saved = (over: Partial<CustomField> = {}): CustomField => ({
  id: "f1",
  entityType: "leads",
  fieldName: "Region",
  fieldType: "select",
  validationSchema: { required: true, options: ["North", "South"] },
  ordinal: 2,
  ...over,
});

describe("fieldReflectsDraft (GAP-CRM-CUSTOM-FIELDS-03)", () => {
  it("is true when the server copy equals the draft it was saved from", () => {
    const f = saved();
    expect(fieldReflectsDraft(toDraft(f), f)).toBe(true);
  });

  it("ignores surrounding whitespace in the name and key order of the stored blob", () => {
    const f = saved({ validationSchema: { options: ["North", "South"], required: true } });
    const draft = { ...toDraft(f), fieldName: "  Region  " };
    expect(fieldReflectsDraft(draft, f)).toBe(true);
  });

  it.each([
    ["a rename", { fieldName: "Zone" }],
    ["a type change", { fieldType: "text" as const }],
    ["a reorder", { ordinal: 5 }],
    ["a Required toggle", { required: false }],
    ["an edited option", { options: ["North", "South-East"] }],
    ["an added option", { options: ["North", "South", "East"] }],
    ["marking it sensitive", { sensitive: true }],
  ])("is false while the server copy still has the old values after %s", (_label, change) => {
    const f = saved();
    expect(fieldReflectsDraft({ ...toDraft(f), ...change }, f)).toBe(false);
  });

  it("is false when the visible-to roles differ on a sensitive field", () => {
    const f = saved({ fieldType: "text", validationSchema: { sensitive: true, visibleToRoles: ["crm_admin"] } });
    const draft = { ...toDraft(f), visibleToRoles: ["crm_admin", "tenant_admin"] };
    expect(fieldReflectsDraft(draft, f)).toBe(false);
    expect(fieldReflectsDraft(toDraft(f), f)).toBe(true);
  });
});

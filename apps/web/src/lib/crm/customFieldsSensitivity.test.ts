import { describe, it, expect } from "vitest";
import {
  buildValidationSchema,
  toDraft,
  blankDraft,
  looksSensitive,
  sensitiveFromValidation,
  visibleToRolesFromValidation,
  type CustomField,
} from "./customFields";

describe("custom-field sensitivity (GAP-CRM-CUSTOM-FIELDS-01)", () => {
  it("buildValidationSchema persists sensitive + visibleToRoles", () => {
    const draft = { ...blankDraft("contacts"), fieldName: "Aadhaar", sensitive: true, visibleToRoles: ["crm_admin"] };
    const vs = buildValidationSchema(draft);
    expect(vs).toMatchObject({ sensitive: true, visibleToRoles: ["crm_admin"] });
  });

  it("omits visibleToRoles when none chosen but keeps sensitive:true", () => {
    const draft = { ...blankDraft("contacts"), fieldName: "PAN", sensitive: true, visibleToRoles: [] };
    const vs = buildValidationSchema(draft);
    expect(vs).toEqual({ sensitive: true });
  });

  it("does not persist sensitivity when the field is not sensitive", () => {
    const draft = { ...blankDraft("contacts"), fieldName: "Nickname", sensitive: false, visibleToRoles: [] };
    const vs = buildValidationSchema(draft);
    expect(vs).toBeNull();
  });

  it("toDraft round-trips sensitive + visibleToRoles", () => {
    const field: CustomField = {
      id: "f1",
      entityType: "contacts",
      fieldName: "Aadhaar",
      fieldType: "text",
      validationSchema: { sensitive: true, visibleToRoles: ["crm_admin", "super_admin"] },
      ordinal: 0,
    };
    const draft = toDraft(field);
    expect(draft.sensitive).toBe(true);
    expect(draft.visibleToRoles).toEqual(["crm_admin", "super_admin"]);
  });

  it("reads sensitivity helpers tolerantly", () => {
    expect(sensitiveFromValidation({ sensitive: true })).toBe(true);
    expect(sensitiveFromValidation({})).toBe(false);
    expect(sensitiveFromValidation(null)).toBe(false);
    expect(visibleToRolesFromValidation({ visibleToRoles: ["a", " b ", ""] })).toEqual(["a", "b"]);
    expect(visibleToRolesFromValidation(null)).toEqual([]);
  });

  it("flags statutory-identifier names as sensitive-looking", () => {
    for (const name of ["Aadhaar", "aadhar number", "PAN", "Passport No", "Ration card", "Bank account no"]) {
      expect(looksSensitive(name)).toBe(true);
    }
    for (const name of ["Nickname", "Favourite colour", "Department"]) {
      expect(looksSensitive(name)).toBe(false);
    }
  });
});

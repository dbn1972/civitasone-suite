/**
 * GAP-CRM phone-data regression guard: the contact create / update / import API must
 * reject a redaction artefact or placeholder stored as a phone (e.g. "<redacted>", which
 * maskPhone renders as "******ted>"). Every write path runs isValidMobile via
 * CONTACT_FORMAT_SPECS (importedContactBody wraps createContactBody), so a bad value
 * can only ever reach the row through an out-of-band insert, never the service.
 */
import { describe, it, expect } from "vitest";
import { createContactBody, updateContactBody } from "../src/modules/contacts/validators.js";

describe("contact phone validator rejects non-phone values", () => {
  it("rejects a redaction artefact on create and update", () => {
    expect(createContactBody.safeParse({ name: "Asha Rao", phone: "<redacted>" }).success).toBe(false);
    expect(updateContactBody.safeParse({ phone: "<redacted>" }).success).toBe(false);
  });

  it("rejects other placeholders / non-mobile strings", () => {
    for (const p of ["N/A", "unknown", "REDACTED", "none", "0123456789", "12345", "+91 98765 43210"])
      expect(createContactBody.safeParse({ name: "X", phone: p }).success).toBe(false);
  });

  it("accepts a valid Indian mobile (with or without +91)", () => {
    for (const p of ["9900001111", "+919876543210", "9123456789"])
      expect(createContactBody.safeParse({ name: "X", phone: p }).success).toBe(true);
  });

  it("keeps phone optional on create and clearable (null) on update", () => {
    expect(createContactBody.safeParse({ name: "X" }).success).toBe(true);
    expect(updateContactBody.safeParse({ phone: null }).success).toBe(true);
  });
});

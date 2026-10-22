import { describe, it, expect } from "vitest";
import { classifyKey, classifyValue, maskAttributes, canSeeCleartextPii } from "../src/shared/pii.js";

describe("cdp pii classifier (pattern based, not an exact-name denylist)", () => {
  it.each([
    "email", "emailAddress", "primary_email", "Mobile Number", "mobileNumber", "phone_no", "contactPerson",
    "pan", "panNumber", "aadhaar", "aadharNo", "uid", "dob", "dateOfBirth", "date_of_birth", "homeAddress", "addresses",
  ])("flags key %s", (k) => expect(classifyKey(k)).not.toBeNull());

  it.each(["name", "company", "panel", "guid", "city", "tier", "expand", "lifetimeValue"])("does not over-mask key %s", (k) =>
    expect(classifyKey(k)).toBeNull());

  it("detects value shapes regardless of key", () => {
    expect(classifyValue("a@b.gov.in")).toBe("email");
    expect(classifyValue("+91 98765 43210")).toBe("phone");
    expect(classifyValue("9876543210")).toBe("phone");
    expect(classifyValue("1234 5678 9012")).toBe("aadhaar");
    expect(classifyValue("123456789012")).toBe("aadhaar");
    expect(classifyValue("hello world")).toBeNull();
  });

  it("masks nested values and arrays and does not mutate the input", () => {
    const input = { contacts: [{ emailAddress: "x@y.com" }], meta: { handle: "x@y.com" }, tier: "gold" };
    const out = maskAttributes(input) as any;
    expect(JSON.stringify(out)).not.toContain("x@y.com");
    expect(out.tier).toBe("gold");
    expect(input.meta.handle).toBe("x@y.com");
  });

  it("masks identifiers embedded in free text", () => {
    const out = maskAttributes({ note: "call 98765 43210 or mail a@b.co; id 1234 5678 9012" }) as any;
    expect(out.note).not.toMatch(/43210|a@b\.co|5678 9012/);
    expect(out.note).toContain("call ");
  });

  it("only admin roles see cleartext", () => {
    expect(canSeeCleartextPii({ roles: ["cdp_user"] })).toBe(false);
    expect(canSeeCleartextPii({ roles: ["cdp_steward"] })).toBe(false);
    expect(canSeeCleartextPii({ roles: ["cdp_admin"] })).toBe(true);
  });
});

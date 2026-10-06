import { describe, it, expect } from "vitest";
import { domainSchema, toFieldErrors } from "./schema";

function parse(partial: Partial<Record<string, string>>) {
  return domainSchema.safeParse({
    domainName: "example.gov.in",
    domainType: "gov.in",
    organisation: "Ministry of X",
    contactEmail: "webmaster@example.gov.in",
    ...partial,
  });
}

describe("domainSchema — domain name (GAP-DOMAINS-NEW-02)", () => {
  it("rejects a bare .in / .co.in host (the old regex accepted these)", () => {
    expect(parse({ domainName: "example.co.in", domainType: "gov.in" }).success).toBe(false);
    expect(parse({ domainName: "foo.in", domainType: "gov.in" }).success).toBe(false);
  });

  it("accepts a .gov.in host", () => {
    expect(parse({ domainName: "example.gov.in" }).success).toBe(true);
  });

  it("accepts a .nic.in host when type matches", () => {
    expect(parse({ domainName: "example.nic.in", domainType: "nic.in" }).success).toBe(true);
  });

  it("lower-cases the submitted domain name", () => {
    const r = parse({ domainName: "Example.GOV.in" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.domainName).toBe("example.gov.in");
  });
});

describe("domainSchema — type cross-check (GAP-DOMAINS-NEW-02)", () => {
  it("nic.in type with a .gov.in name is a domainType field error", () => {
    const r = parse({ domainName: "example.gov.in", domainType: "nic.in" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).domainType).toMatch(/\.nic\.in/);
  });

  it("gov.in type with a .nic.in name is a domainType field error", () => {
    const r = parse({ domainName: "example.nic.in", domainType: "gov.in" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).domainType).toMatch(/\.gov\.in/);
  });

  it("state.gov.in requires a <state>.gov.in host", () => {
    expect(parse({ domainName: "delhi.gov.in", domainType: "state.gov.in" }).success).toBe(true);
  });

  it("rejects the removed 'other' type", () => {
    expect(parse({ domainType: "other" }).success).toBe(false);
  });
});

describe("domainSchema — email & phone (GAP-DOMAINS-NEW-03)", () => {
  it("rejects 'a@b' with the custom email message", () => {
    const r = parse({ contactEmail: "a@b" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).contactEmail).toBe("Enter a valid email address.");
  });

  it("accepts '011-24301001' and '+91 9876543210', rejects 'abc'", () => {
    expect(parse({ contactPhone: "011-24301001" }).success).toBe(true);
    expect(parse({ contactPhone: "+91 9876543210" }).success).toBe(true);
    expect(parse({ contactPhone: "abc" }).success).toBe(false);
  });

  it("allows an empty phone (optional)", () => {
    expect(parse({ contactPhone: "" }).success).toBe(true);
  });

  it("trims inputs before validation", () => {
    const r = parse({ organisation: "  Ministry of X  ", contactEmail: "  a@b.gov.in  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.organisation).toBe("Ministry of X");
      expect(r.data.contactEmail).toBe("a@b.gov.in");
    }
  });
});

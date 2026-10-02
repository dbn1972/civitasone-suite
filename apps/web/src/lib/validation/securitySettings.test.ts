import { describe, it, expect } from "vitest";
import { isValidCidr, validateSecurityChanges, parseIpAllowlist } from "./securitySettings";

describe("isValidCidr (GAP-ADMIN-SETTINGS-03)", () => {
  it("accepts valid IPv4 and IPv6 CIDR ranges", () => {
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("192.168.1.0/24")).toBe(true);
    expect(isValidCidr("203.0.113.5/32")).toBe(true);
    expect(isValidCidr("2001:db8::/32")).toBe(true);
    expect(isValidCidr("::1/128")).toBe(true);
  });
  it("rejects bad prefix lengths, non-addresses and bare IPs", () => {
    expect(isValidCidr("10.0.0.0/33")).toBe(false);
    expect(isValidCidr("abc")).toBe(false);
    expect(isValidCidr("10.0.0.0")).toBe(false);
    expect(isValidCidr("10.0.0.256/8")).toBe(false);
    expect(isValidCidr("10.0.0/8")).toBe(false);
    expect(isValidCidr("2001:db8::/129")).toBe(false);
    expect(isValidCidr("10.0.0.0/")).toBe(false);
  });
});

describe("validateSecurityChanges", () => {
  it("rejects an emptied or out-of-range numeric field instead of coercing it to 0", () => {
    const r = validateSecurityChanges({ sessionTimeoutMin: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sessionTimeoutMin).toBe("Enter 5-480");
    expect(validateSecurityChanges({ sessionTimeoutMin: "0" }).ok).toBe(false);
    expect(validateSecurityChanges({ sessionTimeoutMin: "481" }).ok).toBe(false);
    expect(validateSecurityChanges({ maxLoginAttempts: "21" }).ok).toBe(false);
    expect(validateSecurityChanges({ passwordMinLen: "7" }).ok).toBe(false);
  });
  it("parses valid values and only returns the fields that were changed", () => {
    const r = validateSecurityChanges({ sessionTimeoutMin: "30" });
    expect(r).toEqual({ ok: true, data: { sessionTimeoutMin: 30 } });
  });
  it("flags a bad allow-list line and normalises a good one", () => {
    const bad = validateSecurityChanges({ ipWhitelist: "10.0.0.0/8\nabc" });
    expect(bad.ok).toBe(false);
    const good = validateSecurityChanges({ ipWhitelist: " 10.0.0.0/8 \n\n192.168.1.0/24 " });
    expect(good).toEqual({ ok: true, data: { ipWhitelist: "10.0.0.0/8\n192.168.1.0/24" } });
  });
  it("treats a blank allow-list as valid (allow all) when explicitly changed to blank", () => {
    expect(validateSecurityChanges({ ipWhitelist: "" })).toEqual({ ok: true, data: { ipWhitelist: "" } });
    expect(parseIpAllowlist("a\r\n b ")).toEqual(["a", "b"]);
  });
});

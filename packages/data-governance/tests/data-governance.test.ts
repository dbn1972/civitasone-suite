import { describe, it, expect } from "vitest";
import {
  ConsentRegistry, ConsentDenied, UnknownPurpose,
  applyMasking, applyMaskingList, maskValue, roleAllowed, type MaskingPolicy,
  retentionDeadline, isRetentionExpired, dueForErasure, eraseFields,
} from "../src/index.js";

describe("consent registry (CAP-084)", () => {
  const reg = () => new ConsentRegistry([
    { key: "marketing", description: "promotional messages" },
    { key: "service_delivery", description: "deliver requested service", legitimateUse: true },
  ]);

  it("grants and withdraws, honouring the latest decision", () => {
    const r = reg();
    expect(r.hasConsent("s1", "marketing")).toBe(false);
    r.record("s1", "marketing", "granted");
    expect(r.hasConsent("s1", "marketing")).toBe(true);
    r.record("s1", "marketing", "withdrawn");
    expect(r.hasConsent("s1", "marketing")).toBe(false);
  });

  it("legitimate-use purposes need no consent", () => {
    expect(reg().hasConsent("s1", "service_delivery")).toBe(true);
  });

  it("assertConsent throws when denied and passes when granted", () => {
    const r = reg();
    expect(() => r.assertConsent("s1", "marketing")).toThrow(ConsentDenied);
    r.record("s1", "marketing", "granted");
    expect(() => r.assertConsent("s1", "marketing")).not.toThrow();
  });

  it("rejects unknown purposes", () => {
    expect(() => reg().hasConsent("s1", "nope")).toThrow(UnknownPurpose);
    expect(() => reg().record("s1", "nope", "granted")).toThrow(UnknownPurpose);
    expect(reg().listPurposes().length).toBe(2);
  });
});

describe("masking engine (CAP-085)", () => {
  it("applies each strategy", () => {
    expect(maskValue("123456789012", "partial4")).toBe("********9012");
    expect(maskValue("abcd", "partial4")).toBe("****");
    expect(maskValue("citizen@gov.in", "email")).toBe("c******@gov.in");
    expect(maskValue("secret", "redact")).toBe("******");
    expect(String(maskValue("x", "hash"))).toMatch(/^sha256:/);
    expect(maskValue("keep", "none")).toBe("keep");
    expect(maskValue(null, "redact")).toBeNull();
  });

  const policy: MaskingPolicy = {
    aadhaar: { strategy: "partial4", allowRoles: ["kyc_officer"] },
    email: { strategy: "email", allowRoles: ["kyc_officer", "support"] },
    name: { strategy: "none" },
  };

  it("masks fields the role cannot see, preserves the rest", () => {
    const rec = { id: "c1", name: "Asha", aadhaar: "111122223333", email: "asha@gov.in" };
    const masked = applyMasking(rec, policy, ["support"]);
    expect(masked.id).toBe("c1");
    expect(masked.name).toBe("Asha");           // strategy none
    expect(masked.aadhaar).toBe("********3333"); // support not allowed
    expect(masked.email).toBe("asha@gov.in");    // support allowed → raw
  });

  it("privileged role sees raw values", () => {
    const rec = { aadhaar: "111122223333", email: "asha@gov.in" };
    const masked = applyMasking(rec, policy, ["kyc_officer"]);
    expect(masked.aadhaar).toBe("111122223333");
    expect(masked.email).toBe("asha@gov.in");
  });

  it("empty allowRoles ⇒ always masked; list variant works", () => {
    expect(roleAllowed({ strategy: "redact" }, ["anyone"])).toBe(false);
    const out = applyMaskingList([{ aadhaar: "111122223333" }], { aadhaar: { strategy: "redact" } }, ["kyc_officer"]);
    expect(out[0].aadhaar).toBe("********");
  });

  it("supports a custom formatter function (services plug exact output)", () => {
    const p: MaskingPolicy = { phone: { strategy: (v) => `xxx${String(v).slice(-4)}`, allowRoles: ["admin"] } };
    expect(applyMasking({ phone: "9998887777" }, p, ["viewer"]).phone).toBe("xxx7777");
    expect(applyMasking({ phone: "9998887777" }, p, ["admin"]).phone).toBe("9998887777");
  });
});

describe("retention & erasure (CAP-086)", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const policy = { category: "marketing", retainDays: 30 };

  it("computes deadlines and expiry, honouring legal hold", () => {
    const anchor = new Date("2026-06-01T00:00:00Z");
    expect(retentionDeadline(anchor, policy).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(isRetentionExpired(anchor, policy, now)).toBe(true);
    expect(isRetentionExpired(new Date("2026-07-20"), policy, now)).toBe(false);
    expect(isRetentionExpired(anchor, { ...policy, legalHold: true }, now)).toBe(false);
  });

  it("filters records due for erasure", () => {
    const rows = [{ id: "a", at: new Date("2026-06-01") }, { id: "b", at: new Date("2026-07-25") }];
    const due = dueForErasure(rows, (r) => r.at, policy, now);
    expect(due.map((r) => r.id)).toEqual(["a"]);
  });

  it("erases PII fields while preserving ids/timestamps", () => {
    const rec = { id: "c1", createdAt: "2026-01-01", aadhaar: "111122223333", name: "Asha" };
    expect(eraseFields(rec, ["aadhaar", "name"]).aadhaar).toBe("[erased]");
    expect(eraseFields(rec, ["aadhaar"], "null").aadhaar).toBeNull();
    expect(String(eraseFields(rec, ["aadhaar"], "hash").aadhaar)).toBe("erased:12");
    expect(eraseFields(rec, ["aadhaar"]).id).toBe("c1"); // preserved
  });
});

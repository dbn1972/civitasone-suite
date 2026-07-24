/**
 * SVC-083/085/086/090 — pure domain evaluator unit tests (no I/O).
 * Targets 100% coverage of every new domain file.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRule, evaluateEligibility, assertRulesWellFormed, type EligibilityRule,
} from "../src/modules/eligibility/domain.js";
import {
  computeFee, buildReceiptNo, isGatewayConfigured, isRefundable, type ExemptionRule,
} from "../src/modules/fee-payment/domain.js";
import {
  normalizeCertType, buildCertNumber, canonicalize, hashPayload, signPayloadHash,
  verifySignature, generateVerifyToken, isExpired, publicValidity,
} from "../src/modules/issuance/domain.js";
import { matchServices, isConsentActive } from "../src/modules/discovery/domain.js";

// ─────────────────────────────── SVC-083 ────────────────────────────────────
describe("SVC-083 evaluateRule operators", () => {
  const S = { age: 65, income: 120000, category: "sc", flags: "x" };
  it("eq / neq", () => {
    expect(evaluateRule({ id: "r", attribute: "category", op: "eq", value: "sc", effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "category", op: "neq", value: "gen", effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "category", op: "eq", value: "gen", effect: "disqualify" }, S)).toBe(false);
  });
  it("numeric gt/gte/lt/lte with string coercion", () => {
    expect(evaluateRule({ id: "r", attribute: "age", op: "gte", value: 60, effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "age", op: "gt", value: 65, effect: "disqualify" }, S)).toBe(false);
    expect(evaluateRule({ id: "r", attribute: "income", op: "lt", value: 200000, effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "income", op: "lte", value: 120000, effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "age", op: "gt", value: "60", effect: "disqualify" }, { age: "65" })).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "age", op: "gt", value: "x", effect: "disqualify" }, S)).toBe(false);
  });
  it("in / nin", () => {
    expect(evaluateRule({ id: "r", attribute: "category", op: "in", value: ["sc", "st"], effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "category", op: "nin", value: ["gen"], effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "category", op: "in", value: "notarray" as unknown, effect: "disqualify" }, S)).toBe(false);
    expect(evaluateRule({ id: "r", attribute: "category", op: "nin", value: "notarray" as unknown, effect: "disqualify" }, S)).toBe(false);
  });
  it("exists / missing", () => {
    expect(evaluateRule({ id: "r", attribute: "flags", op: "exists", effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "nope", op: "exists", effect: "disqualify" }, S)).toBe(false);
    expect(evaluateRule({ id: "r", attribute: "nope", op: "missing", effect: "disqualify" }, S)).toBe(true);
    expect(evaluateRule({ id: "r", attribute: "flags", op: "missing", effect: "disqualify" }, S)).toBe(false);
    expect(evaluateRule({ id: "r", attribute: "n", op: "exists", effect: "disqualify" }, { n: null })).toBe(false);
  });
  it("unknown op returns false", () => {
    expect(evaluateRule({ id: "r", attribute: "age", op: "bogus" as never, effect: "disqualify" }, S)).toBe(false);
  });
});

describe("SVC-083 evaluateEligibility outcomes", () => {
  it("empty rules → eligible", () => {
    expect(evaluateEligibility([], {}).outcome).toBe("eligible");
  });
  it("all pass → eligible with positive reasons", () => {
    const rules: EligibilityRule[] = [{ id: "a", attribute: "age", op: "gte", value: 18, effect: "disqualify", label: "adult" }];
    const r = evaluateEligibility(rules, { age: 30 });
    expect(r.outcome).toBe("eligible");
    expect(r.reasons[0].passed).toBe(true);
    expect(r.reasons[0].message).toContain("Passed");
  });
  it("failing disqualify rule → not_eligible", () => {
    const rules: EligibilityRule[] = [{ id: "a", attribute: "age", op: "gte", value: 60, effect: "disqualify" }];
    expect(evaluateEligibility(rules, { age: 40 }).outcome).toBe("not_eligible");
  });
  it("failing refer rule → refer_manual", () => {
    const rules: EligibilityRule[] = [{ id: "a", attribute: "doc", op: "exists", effect: "refer" }];
    const r = evaluateEligibility(rules, {});
    expect(r.outcome).toBe("refer_manual");
    expect(r.reasons[0].message).toContain("Failed");
  });
  it("disqualify precedence over refer", () => {
    const rules: EligibilityRule[] = [
      { id: "d", attribute: "age", op: "gte", value: 60, effect: "disqualify" },
      { id: "r", attribute: "doc", op: "exists", effect: "refer" },
    ];
    expect(evaluateEligibility(rules, { age: 40 }).outcome).toBe("not_eligible");
  });
});

describe("SVC-083 assertRulesWellFormed", () => {
  it("accepts a valid array", () => {
    expect(() => assertRulesWellFormed([{ id: "a", attribute: "x", op: "eq", value: 1, effect: "refer" }])).not.toThrow();
  });
  it("rejects non-array / bad rules", () => {
    expect(() => assertRulesWellFormed("nope")).toThrow("RULES_NOT_ARRAY");
    expect(() => assertRulesWellFormed([null])).toThrow("RULE_NOT_OBJECT");
    expect(() => assertRulesWellFormed([{ attribute: "x", op: "eq", effect: "refer" }])).toThrow("RULE_MISSING_ID");
    expect(() => assertRulesWellFormed([{ id: "a", op: "eq", effect: "refer" }])).toThrow("RULE_MISSING_ATTRIBUTE");
    expect(() => assertRulesWellFormed([{ id: "a", attribute: "x", op: "bad", effect: "refer" }])).toThrow("RULE_BAD_OP");
    expect(() => assertRulesWellFormed([{ id: "a", attribute: "x", op: "eq", effect: "bad" }])).toThrow("RULE_BAD_EFFECT");
    expect(() => assertRulesWellFormed([{ id: "a", attribute: "x", op: "in", value: 1, effect: "refer" }])).toThrow("RULE_OP_NEEDS_ARRAY");
    expect(() => assertRulesWellFormed([
      { id: "a", attribute: "x", op: "eq", effect: "refer" },
      { id: "a", attribute: "y", op: "eq", effect: "refer" },
    ])).toThrow("RULE_DUPLICATE_ID");
  });
});

// ─────────────────────────────── SVC-085 ────────────────────────────────────
describe("SVC-085 computeFee", () => {
  const exemptions: ExemptionRule[] = [
    { id: "bpl", attribute: "bpl", op: "eq", value: true, kind: "waive", label: "BPL waiver" },
    { id: "sr", attribute: "senior", op: "eq", value: true, kind: "percent", amount: 50 },
    { id: "vet", attribute: "veteran", op: "eq", value: true, kind: "flat", amount: 30 },
  ];
  it("no exemption → base amount", () => {
    const r = computeFee(100, exemptions, {});
    expect(r.amount).toBe(100);
    expect(r.exemptionApplied).toBeNull();
  });
  it("waive → zero, first match wins", () => {
    const r = computeFee(100, exemptions, { bpl: true, senior: true });
    expect(r.amount).toBe(0);
    expect(r.exemptionApplied).toBe("bpl");
    expect(r.exemptionLabel).toBe("BPL waiver");
  });
  it("percent reduction", () => {
    expect(computeFee(100, exemptions, { senior: true }).amount).toBe(50);
  });
  it("flat reduction clamped at zero", () => {
    expect(computeFee(20, exemptions, { veteran: true }).amount).toBe(0);
    expect(computeFee(100, exemptions, { veteran: true }).amount).toBe(70);
  });
  it("negative base clamped; rounding to 2dp", () => {
    expect(computeFee(-5, [], {}).amount).toBe(0);
    expect(computeFee(99.999, [], {}).amount).toBe(100);
  });
  it("percent/flat with missing amount default 0", () => {
    const ex: ExemptionRule[] = [{ id: "p", attribute: "a", op: "eq", value: 1, kind: "percent" }];
    expect(computeFee(100, ex, { a: 1 }).amount).toBe(100);
  });
});

describe("SVC-085 helpers", () => {
  it("buildReceiptNo pads", () => {
    expect(buildReceiptNo(2026, 42)).toBe("RCT-2026-00000042");
  });
  it("isGatewayConfigured honesty gate", () => {
    expect(isGatewayConfigured({})).toBe(false);
    expect(isGatewayConfigured({ PAYMENT_GATEWAY_KEY: "  " })).toBe(false);
    expect(isGatewayConfigured({ PAYMENT_GATEWAY_KEY: "sk_live" })).toBe(true);
    expect(isGatewayConfigured({ CITIZEN_PAYMENT_GATEWAY_KEY: "k" })).toBe(true);
  });
  it("isRefundable", () => {
    expect(isRefundable("paid")).toBe(true);
    expect(isRefundable("offline_recorded")).toBe(true);
    expect(isRefundable("pending")).toBe(false);
  });
});

// ─────────────────────────────── SVC-086 ────────────────────────────────────
describe("SVC-086 issuance domain", () => {
  it("normalizeCertType", () => {
    expect(normalizeCertType("birth cert")).toBe("BIRTH_CERT");
    expect(normalizeCertType(" trade-licence ")).toBe("TRADE_LICENCE");
    expect(() => normalizeCertType("!")).toThrow("INVALID_CERT_TYPE");
  });
  it("buildCertNumber gapless format + validation", () => {
    expect(buildCertNumber("BIRTH", 2026, 7)).toBe("BIRTH-2026-000007");
    expect(() => buildCertNumber("BIRTH", 2026, 0)).toThrow("INVALID_SEQ");
    expect(() => buildCertNumber("BIRTH", 2026, 1.5)).toThrow("INVALID_SEQ");
  });
  it("canonicalize sorts keys + handles arrays; hash stable across key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]');
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it("canonicalize rejects circular", () => {
    const o: Record<string, unknown> = {}; o.self = o;
    expect(() => canonicalize(o)).toThrow("CIRCULAR_PAYLOAD");
  });
  it("sign + verify roundtrip; tamper detection", () => {
    const payload = { certNo: "BIRTH-2026-000001", name: "A" };
    const h = hashPayload(payload);
    const sig = signPayloadHash(h);
    expect(verifySignature(payload, h, sig)).toBe(true);
    expect(verifySignature({ ...payload, name: "B" }, h, sig)).toBe(false);
    expect(verifySignature(payload, h, "deadbeef")).toBe(false);
  });
  it("generateVerifyToken is unique + urlsafe", () => {
    const a = generateVerifyToken(); const b = generateVerifyToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("isExpired + publicValidity", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired("2026-07-23", now)).toBe(true);
    expect(isExpired("2026-07-25", now)).toBe(false);
    expect(publicValidity("active", "2026-07-25", now)).toBe("valid");
    expect(publicValidity("active", "2026-07-23", now)).toBe("expired");
    expect(publicValidity("revoked", "2027-01-01", now)).toBe("invalid");
    expect(publicValidity("requested", null, now)).toBe("invalid");
    expect(publicValidity("renewed", null, now)).toBe("valid");
  });
});

// ─────────────────────────────── SVC-090 ────────────────────────────────────
describe("SVC-090 discovery domain", () => {
  const candidates = [
    { serviceId: "s1", ruleSetId: "rs1", rules: [{ id: "a", attribute: "age", op: "gte" as const, value: 60, effect: "disqualify" as const }] },
    { serviceId: "s2", ruleSetId: "rs2", rules: [{ id: "b", attribute: "doc", op: "exists" as const, effect: "refer" as const }] },
    { serviceId: "s3", ruleSetId: "rs3", rules: [] },
  ];
  it("returns strong + soft matches; skips not_eligible", () => {
    const m = matchServices(candidates, { age: 70 });
    const ids = m.map((x) => x.serviceId);
    expect(ids).toContain("s1"); // eligible (strong)
    expect(ids).toContain("s2"); // refer_manual (soft)
    expect(ids).toContain("s3"); // empty rules → eligible
    expect(m.find((x) => x.serviceId === "s1")!.strength).toBe("strong");
    expect(m.find((x) => x.serviceId === "s2")!.strength).toBe("soft");
  });
  it("excludes services that disqualify", () => {
    const m = matchServices(candidates, { age: 40, doc: "x" });
    expect(m.map((x) => x.serviceId)).not.toContain("s1");
  });
  it("isConsentActive", () => {
    expect(isConsentActive(null)).toBe(false);
    expect(isConsentActive({ granted: true, revokedAt: null })).toBe(true);
    expect(isConsentActive({ granted: false, revokedAt: null })).toBe(false);
    expect(isConsentActive({ granted: true, revokedAt: new Date() })).toBe(false);
  });
});

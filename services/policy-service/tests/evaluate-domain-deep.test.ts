/**
 * Policy Service — Evaluate Domain: Deep tests.
 *
 * Tests permission key parsing, RBAC decision logic, super_admin bypass,
 * ABAC combination precedence (deny-overrides, permit-extends), and caching.
 *
 * Source: modules/evaluate/domain.ts
 */
import { describe, it, expect } from "vitest";
import { parsePermissionKey, evaluateDecision, combineWithAbac, type EvaluateResult } from "../src/modules/evaluate/domain.js";
import type { Decision as AbacDecision } from "../src/modules/abac/domain.js";

describe("parsePermissionKey", () => {
  it("parses resource.action from dotted key", () => {
    expect(parsePermissionKey("hr.employee.read")).toEqual({ resource: "hr.employee", action: "read" });
  });
  it("handles deeply nested resource", () => {
    expect(parsePermissionKey("finance.gl.journal.write")).toEqual({ resource: "finance.gl.journal", action: "write" });
  });
  it("throws for too few parts (< 3)", () => {
    expect(() => parsePermissionKey("read")).toThrow("invalid permission key");
    expect(() => parsePermissionKey("hr.read")).toThrow();
  });
});

describe("evaluateDecision — RBAC permission check", () => {
  const granted = [
    { resource: "hr.employee", action: "read", effect: "allow", roleName: "hr_officer" },
    { resource: "hr.employee", action: "write", effect: "allow", roleName: "hr_admin" },
    { resource: "finance.gl", action: "read", effect: "allow", roleName: "finance_officer" },
  ];

  it("super_admin always gets allow", () => {
    const result = evaluateDecision("anything.here.read", ["super_admin"], []);
    expect(result.decision).toBe("allow");
    expect(result.reason).toContain("super_admin");
    expect(result.cacheable).toBe(true);
  });

  it("allow when role has matching permission", () => {
    const result = evaluateDecision("hr.employee.read", ["hr_officer"], granted);
    expect(result.decision).toBe("allow");
    expect(result.reason).toContain("hr_officer");
  });

  it("deny when no matching permission", () => {
    const result = evaluateDecision("hr.employee.delete", ["hr_officer"], granted);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("no permission");
  });

  it("deny for empty roles when no grant matches", () => {
    const result = evaluateDecision("hr.employee.delete", [], granted);
    expect(result.decision).toBe("deny");
  });

  it("matches exact resource + action", () => {
    const result = evaluateDecision("finance.gl.read", ["finance_officer"], granted);
    expect(result.decision).toBe("allow");
  });

  it("does not cross-match different resource", () => {
    const result = evaluateDecision("finance.gl.write", ["finance_officer"], granted);
    expect(result.decision).toBe("deny");
  });

  it("result has cacheable=true and ttlSeconds", () => {
    const result = evaluateDecision("hr.employee.read", ["hr_officer"], granted);
    expect(result.cacheable).toBe(true);
    expect(result.ttlSeconds).toBeGreaterThan(0);
  });
});

describe("combineWithAbac — RBAC+ABAC precedence", () => {
  const roleAllow: EvaluateResult = { decision: "allow", reason: "role:hr_officer+hr.employee.read", cacheable: true, ttlSeconds: 60 };
  const roleDeny: EvaluateResult = { decision: "deny", reason: "no permission for x.y.z", cacheable: true, ttlSeconds: 30 };

  it("ABAC deny overrides RBAC allow (deny-overrides)", () => {
    const abac: AbacDecision = { decision: "deny", reason: "jurisdiction mismatch", matchedRuleId: "rule-1" };
    const result = combineWithAbac(roleAllow, abac);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("abac:deny");
    expect(result.cacheable).toBe(false); // attribute-dependent
  });

  it("ABAC permit with no RBAC deny → extends access", () => {
    const abac: AbacDecision = { decision: "permit", reason: "explicit allow", matchedRuleId: "rule-2" };
    const result = combineWithAbac(roleDeny, abac);
    expect(result.decision).toBe("allow");
    expect(result.reason).toContain("abac:permit");
  });

  it("RBAC allow preserved when ABAC has no matched rule", () => {
    const abac: AbacDecision = { decision: "deny", reason: "default deny" }; // no matchedRuleId
    const result = combineWithAbac(roleAllow, abac);
    expect(result.decision).toBe("allow"); // no explicit rule = default
    expect(result.reason).toBe(roleAllow.reason);
  });

  it("RBAC allow + ABAC permit appends to reason", () => {
    const abac: AbacDecision = { decision: "permit", reason: "ok", matchedRuleId: "rule-3" };
    const result = combineWithAbac(roleAllow, abac);
    expect(result.decision).toBe("allow");
    expect(result.reason).toContain("abac:permit");
    expect(result.cacheable).toBe(false);
  });

  it("both deny when RBAC deny + ABAC no match", () => {
    const abac: AbacDecision = { decision: "deny", reason: "default" };
    const result = combineWithAbac(roleDeny, abac);
    expect(result.decision).toBe("deny");
  });
});

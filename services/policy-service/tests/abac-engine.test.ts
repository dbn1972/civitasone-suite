import { describe, it, expect } from "vitest";
import {
  evaluate,
  evalPredicate,
  resolvePath,
  parseExpression,
  assertExpression,
  ExpressionError,
  type CompiledRule,
  type AccessRequest,
  type RuleExpression,
} from "../src/modules/abac/domain.js";

const TENANT = "11111111-1111-4000-8000-000000000001";
const ROLE_MGR = "22222222-2222-4000-8000-000000000002";
const ROLE_STAFF = "33333333-3333-4000-8000-000000000003";

function rule(id: string, roleId: string, expr: RuleExpression, enabled = true): CompiledRule {
  return { id, roleId, enabled, expression: expr };
}

function req(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    subject: { id: "user-1", roleIds: [ROLE_MGR], attrs: { userId: "user-1" } },
    action: "approve",
    resource: { type: "leave", attrs: { ownerId: "user-1", tenantId: TENANT } },
    context: { tenantId: TENANT },
    ...over,
  };
}

describe("resolvePath", () => {
  it("reads subject/resource/context/action roots", () => {
    const r = req();
    expect(resolvePath(r, "action")).toBe("approve");
    expect(resolvePath(r, "subject.id")).toBe("user-1");
    expect(resolvePath(r, "resource.type")).toBe("leave");
    expect(resolvePath(r, "context.tenantId")).toBe(TENANT);
  });
  it("flattens attrs onto the root view", () => {
    expect(resolvePath(req(), "resource.ownerId")).toBe("user-1");
    expect(resolvePath(req(), "subject.userId")).toBe("user-1");
  });
  it("returns undefined for unknown roots / missing keys", () => {
    expect(resolvePath(req(), "bogus.x")).toBeUndefined();
    expect(resolvePath(req(), "resource.attrs.missing")).toBeUndefined();
  });
});

describe("predicates", () => {
  it("equals", () => {
    expect(evalPredicate(req(), { op: "equals", path: "resource.type", value: "leave" })).toBe(true);
    expect(evalPredicate(req(), { op: "equals", path: "resource.type", value: "payroll" })).toBe(false);
  });
  it("in", () => {
    expect(evalPredicate(req(), { op: "in", path: "action", values: ["read", "approve"] })).toBe(true);
    expect(evalPredicate(req(), { op: "in", path: "action", values: ["read"] })).toBe(false);
  });
  it("exists", () => {
    expect(evalPredicate(req(), { op: "exists", path: "resource.ownerId" })).toBe(true);
    expect(evalPredicate(req(), { op: "exists", path: "resource.attrs.nope" })).toBe(false);
  });
  it("owner-match true when subject owns resource", () => {
    expect(evalPredicate(req(), { op: "owner-match" })).toBe(true);
  });
  it("owner-match false when owner differs", () => {
    const r = req({ resource: { type: "leave", attrs: { ownerId: "someone-else", tenantId: TENANT } } });
    expect(evalPredicate(r, { op: "owner-match" })).toBe(false);
  });
  it("owner-match false when owner attr absent (no vacuous match)", () => {
    const r = req({ resource: { type: "leave", attrs: { tenantId: TENANT } } });
    expect(evalPredicate(r, { op: "owner-match" })).toBe(false);
  });
  it("tenant-match true within tenant, false across tenants", () => {
    expect(evalPredicate(req(), { op: "tenant-match" })).toBe(true);
    const r = req({ resource: { type: "leave", attrs: { ownerId: "user-1", tenantId: "other-tenant" } } });
    expect(evalPredicate(r, { op: "tenant-match" })).toBe(false);
  });
});

describe("evaluate — precedence & defaults", () => {
  const allowMgr = rule("rule-allow", ROLE_MGR, {
    effect: "allow", action: "approve", resourceType: "leave", predicates: [{ op: "owner-match" }],
  });

  it("permits when an allow rule matches", () => {
    const d = evaluate([allowMgr], req());
    expect(d.decision).toBe("permit");
    expect(d.matchedRuleId).toBe("rule-allow");
  });

  it("default-deny when no rule matches", () => {
    const d = evaluate([], req());
    expect(d.decision).toBe("deny");
    expect(d.reason).toContain("default-deny");
    expect(d.matchedRuleId).toBeUndefined();
  });

  it("deny-overrides: a matching deny beats a matching allow", () => {
    const denyMgr = rule("rule-deny", ROLE_MGR, {
      effect: "deny", action: "approve", resourceType: "leave", predicates: [],
    });
    const d = evaluate([allowMgr, denyMgr], req());
    expect(d.decision).toBe("deny");
    expect(d.matchedRuleId).toBe("rule-deny");
  });

  it("does not match rules for roles the subject lacks", () => {
    const allowStaff = rule("rule-staff", ROLE_STAFF, {
      effect: "allow", action: "approve", resourceType: "leave", predicates: [],
    });
    expect(evaluate([allowStaff], req()).decision).toBe("deny");
  });

  it("wildcard action/resourceType target anything", () => {
    const wild = rule("rule-wild", ROLE_MGR, {
      effect: "allow", action: "*", resourceType: "*", predicates: [],
    });
    expect(evaluate([wild], req({ action: "delete" })).decision).toBe("permit");
  });

  it("ignores disabled rules", () => {
    const disabled = rule("rule-off", ROLE_MGR, {
      effect: "allow", action: "approve", resourceType: "leave", predicates: [],
    }, false);
    expect(evaluate([disabled], req()).decision).toBe("deny");
  });

  it("denies when a predicate fails (owner mismatch)", () => {
    const r = req({ resource: { type: "leave", attrs: { ownerId: "other", tenantId: TENANT } } });
    expect(evaluate([allowMgr], r).decision).toBe("deny");
  });

  it("cross-tenant resource is denied via tenant-match predicate", () => {
    const tenantScoped = rule("rule-tenant", ROLE_MGR, {
      effect: "allow", action: "approve", resourceType: "leave", predicates: [{ op: "tenant-match" }],
    });
    const r = req({ resource: { type: "leave", attrs: { ownerId: "user-1", tenantId: "other" } } });
    expect(evaluate([tenantScoped], r).decision).toBe("deny");
  });
});

describe("expression parsing/validation", () => {
  it("parses a valid JSON expression", () => {
    const raw = JSON.stringify({ effect: "allow", action: "read", resourceType: "doc", predicates: [{ op: "exists", path: "subject.id" }] });
    expect(parseExpression(raw).effect).toBe("allow");
  });
  it("rejects non-JSON", () => {
    expect(() => parseExpression("not json")).toThrow(ExpressionError);
  });
  it("rejects bad effect", () => {
    expect(() => assertExpression({ effect: "maybe", action: "a", resourceType: "r", predicates: [] })).toThrow(ExpressionError);
  });
  it("rejects unknown predicate op", () => {
    expect(() => assertExpression({ effect: "allow", action: "a", resourceType: "r", predicates: [{ op: "regex" }] })).toThrow(ExpressionError);
  });
  it("rejects missing predicates array", () => {
    expect(() => assertExpression({ effect: "allow", action: "a", resourceType: "r" })).toThrow(ExpressionError);
  });
});

/**
 * EPIC-2 (G-09/G-10) regression: the RBAC evaluator now consults `abac.rules`
 * so jurisdiction/office attributes fence access. Before wiring, `abac.rules`
 * was a dead table and an SDM could read any subdivision's records.
 *
 * These tests exercise the pure RBAC-then-ABAC combine (evaluateWithAbac +
 * combineWithAbac) — no DB required. They FAIL against the old role-only
 * evaluateDecision (which has no ABAC path at all) and PASS with the wiring.
 */
import { describe, it, expect } from "vitest";
import { evaluateWithAbac, combineWithAbac } from "../src/modules/evaluate/domain.js";
import type { CompiledRule } from "../src/modules/abac/domain.js";

const GRANT_READ_CASE = [
  { resource: "revenue.case", action: "read", effect: "allow", roleName: "sdm" },
];

// A jurisdiction fence: DENY reading a revenue.case UNLESS the case's
// subdivisionId matches the SDM's own jurisdiction (owner-match). Keyed on the
// SDM role id so only SDMs are fenced.
const JURISDICTION_FENCE: CompiledRule[] = [
  {
    id: "rule-sdm-fence",
    roleId: "role-sdm-uuid",
    enabled: true,
    expression: {
      effect: "deny",
      action: "read",
      resourceType: "revenue.case",
      predicates: [
        {
          op: "not",
          predicate: {
            op: "owner-match",
            subjectPath: "subject.attrs.jurisSubdivision",
            resourcePath: "resource.attrs.subdivisionId",
          },
        },
      ],
    },
  },
];

function base(resourceSubdivision: string) {
  return {
    permissionKey: "revenue.case.read",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    roles: ["sdm"],
    roleIds: ["role-sdm-uuid"],
    subjectAttrs: { jurisSubdivision: "SD-1" as unknown },
    resource: { subdivisionId: resourceSubdivision as unknown },
    granted: GRANT_READ_CASE,
    compiledRules: JURISDICTION_FENCE,
  };
}

describe("ABAC jurisdiction fencing (EPIC-2 / G-09)", () => {
  it("ALLOWS an SDM to read a case in their OWN subdivision", () => {
    const r = evaluateWithAbac(base("SD-1"));
    expect(r.decision).toBe("allow");
  });

  it("DENIES an SDM reading a case in ANOTHER subdivision (role allows, ABAC fences)", () => {
    const r = evaluateWithAbac(base("SD-2"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/abac:deny:rule-sdm-fence/);
  });

  it("does not cache attribute-dependent decisions", () => {
    expect(evaluateWithAbac(base("SD-2")).cacheable).toBe(false);
  });

  it("with NO abac rules, the RBAC grant stands (backward compatible)", () => {
    const r = evaluateWithAbac({ ...base("SD-9"), compiledRules: [] });
    expect(r.decision).toBe("allow");
  });

  it("combineWithAbac: an explicit ABAC deny overrides a role allow", () => {
    const role = { decision: "allow" as const, reason: "role:x", cacheable: true, ttlSeconds: 60 };
    const out = combineWithAbac(role, { decision: "deny", reason: "x", matchedRuleId: "r9" });
    expect(out.decision).toBe("deny");
  });

  it("combineWithAbac: an explicit ABAC permit extends access where role was silent", () => {
    const role = { decision: "deny" as const, reason: "no perm", cacheable: true, ttlSeconds: 30 };
    const out = combineWithAbac(role, { decision: "permit", reason: "x", matchedRuleId: "r7" });
    expect(out.decision).toBe("allow");
  });

  it("combineWithAbac: a non-matching ABAC result leaves the role decision unchanged", () => {
    const role = { decision: "deny" as const, reason: "no perm", cacheable: true, ttlSeconds: 30 };
    const out = combineWithAbac(role, { decision: "deny", reason: "default-deny: no matching rule" });
    expect(out.decision).toBe("deny");
    expect(out.reason).toBe("no perm");
  });
});

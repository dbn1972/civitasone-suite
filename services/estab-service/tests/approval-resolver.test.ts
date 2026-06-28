import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the cache so the resolver runs against an in-memory rule set.
const rulesByKey = new Map<string, unknown[]>();

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (tenantId: string, resource: string, id: string) => `${tenantId}:${resource}:${id}`,
    getOrLoad: async <T,>(key: string, loader: () => Promise<T>) => {
      if (rulesByKey.has(key)) return rulesByKey.get(key) as T;
      return loader();
    },
    invalidate: async () => {},
  },
}));

vi.mock("../src/shared/db.js", () => ({ db: {} }));

const T = "11111111-1111-1111-1111-111111111111";

function rule(over: Record<string, unknown>) {
  return {
    id: over.id ?? "r", tenantId: T, module: "finance", sourceType: "finance_sanction",
    label: "rule", minAmountMinor: 0, maxAmountMinor: null,
    workflowDefinitionCode: "wf.default", startNodeKey: "review", steps: [],
    priority: 100, active: true, version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: T, updatedBy: T,
    ...over,
  };
}

let resolveApproval: typeof import("../src/modules/approval-rules/resolver.js").resolveApproval;

beforeEach(async () => {
  rulesByKey.clear();
  ({ resolveApproval } = await import("../src/modules/approval-rules/resolver.js"));
});

describe("resolveApproval — amount band matrix", () => {
  it("returns null when no rule matches", async () => {
    rulesByKey.set(`${T}:approval_rules:finance_sanction`, []);
    const r = await resolveApproval(T, "finance_sanction", 50000);
    expect(r).toBeNull();
  });

  it("picks the band the amount falls into", async () => {
    rulesByKey.set(`${T}:approval_rules:finance_sanction`, [
      rule({ id: "low", minAmountMinor: 0, maxAmountMinor: 500_000_00, workflowDefinitionCode: "wf.director" }),
      rule({ id: "mid", minAmountMinor: 500_000_00, maxAmountMinor: 5_000_000_00, workflowDefinitionCode: "wf.director_cto" }),
      rule({ id: "high", minAmountMinor: 5_000_000_00, maxAmountMinor: null, workflowDefinitionCode: "wf.director_cto_ceo" }),
    ]);
    expect((await resolveApproval(T, "finance_sanction", 100_000_00))?.workflowDefinitionCode).toBe("wf.director");
    expect((await resolveApproval(T, "finance_sanction", 1_000_000_00))?.workflowDefinitionCode).toBe("wf.director_cto");
    expect((await resolveApproval(T, "finance_sanction", 9_000_000_00))?.workflowDefinitionCode).toBe("wf.director_cto_ceo");
  });

  it("treats max bound as exclusive and unbounded max as open-ended", async () => {
    rulesByKey.set(`${T}:approval_rules:finance_sanction`, [
      rule({ id: "low", minAmountMinor: 0, maxAmountMinor: 500_000_00, workflowDefinitionCode: "wf.low" }),
      rule({ id: "high", minAmountMinor: 500_000_00, maxAmountMinor: null, workflowDefinitionCode: "wf.high" }),
    ]);
    // Exactly at the boundary goes to the upper band (max is exclusive).
    expect((await resolveApproval(T, "finance_sanction", 500_000_00))?.workflowDefinitionCode).toBe("wf.high");
  });

  it("prefers the most specific (highest min) band on overlap", async () => {
    rulesByKey.set(`${T}:approval_rules:finance_sanction`, [
      rule({ id: "broad", minAmountMinor: 0, maxAmountMinor: null, workflowDefinitionCode: "wf.broad", priority: 100 }),
      rule({ id: "narrow", minAmountMinor: 1_000_000_00, maxAmountMinor: null, workflowDefinitionCode: "wf.narrow", priority: 100 }),
    ]);
    expect((await resolveApproval(T, "finance_sanction", 2_000_000_00))?.workflowDefinitionCode).toBe("wf.narrow");
  });
});

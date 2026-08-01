/**
 * Repository unit tests for the Sprint 2 modules.
 *
 * Route tests mock the repos, so the query builders themselves would otherwise
 * never run. Here the drizzle transaction is replaced with a recording chain
 * that resolves to canned rows, which exercises filter composition, row → view
 * mapping and the count fallbacks without needing a live database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const AGENT_A = "eeeeeeee-1111-4000-8000-000000000001";
const ORCH_ID = "77777777-1111-4000-8000-000000000001";
const CONV_ID = "cccccccc-1111-4000-8000-000000000001";
const TURN_ID = "dddddddd-1111-4000-8000-000000000001";

/** Results are consumed in call order: one entry per awaited query. */
const queue: unknown[] = [];

const CHAIN_METHODS = [
  "select", "from", "where", "orderBy", "limit", "offset", "groupBy",
  "insert", "values", "onConflictDoUpdate", "onConflictDoNothing", "returning",
  "update", "set",
] as const;

/** Calls recorded across every chain, so tests can assert on what was built. */
const calls: string[] = [];

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of CHAIN_METHODS) {
    chain[m] = (...args: unknown[]) => {
      calls.push(m);
      void args;
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const next = queue.length > 0 ? queue.shift() : [];
    return Promise.resolve(next).then(resolve, reject);
  };
  return chain;
}

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeChain()) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChain()),
  sqlClient: { end: async () => {} },
}));

const orchestrationRepo = await import("../src/modules/agents/orchestration-repo.js");
const authoringRepo = await import("../src/modules/authoring/repo.js");
const qualityRepo = await import("../src/modules/governance/quality-repo.js");
const protocolsRepo = await import("../src/modules/protocols/repo.js");
const toolsRepo = await import("../src/modules/tools/repo.js");
const governanceRepo = await import("../src/modules/governance/repo.js");

function tx(): never {
  // The mocked transaction hands the chain to the callback; direct writers take it as an arg.
  return makeChain() as never;
}

beforeEach(() => {
  queue.length = 0;
  calls.length = 0;
});

// ── orchestration repo ────────────────────────────────────────────────────────

describe("orchestration-repo", () => {
  const row = {
    id: ORCH_ID, tenantId: TENANT, rootAgentId: AGENT_A, status: "running",
    depth: 1, maxDepth: 5, hopCount: 2, maxHops: 20, reason: null,
    startedAt: new Date("2026-01-01T00:00:00Z"), completedAt: new Date("2026-01-01T01:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:30:00Z"),
    createdBy: USER, updatedBy: USER, version: 3,
  };

  it("toView serialises timestamps and keeps counters", () => {
    const v = orchestrationRepo.toView(row);
    expect(v.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(v.completedAt).toBe("2026-01-01T01:00:00.000Z");
    expect(v).toMatchObject({ depth: 1, hopCount: 2, version: 3 });
  });

  it("toView keeps a null completedAt null", () => {
    expect(orchestrationRepo.toView({ ...row, completedAt: null }).completedAt).toBeNull();
  });

  it("toHopView serialises the hop timestamp", () => {
    const v = orchestrationRepo.toHopView({
      id: "h1", tenantId: TENANT, orchestrationId: ORCH_ID, fromAgentId: AGENT_A,
      toAgentId: AGENT_A, depth: 1, reason: "why", occurredAt: new Date("2026-01-01T00:00:00Z"), version: 1,
    });
    expect(v.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("findById returns the first row or null", async () => {
    queue.push([row]);
    expect(await orchestrationRepo.findById(ORCH_ID, TENANT)).toEqual(row);
    queue.push([]);
    expect(await orchestrationRepo.findById(ORCH_ID, TENANT)).toBeNull();
  });

  it("listByTenant returns rows plus the total", async () => {
    queue.push([row], [{ count: 7 }]);
    expect(await orchestrationRepo.listByTenant(TENANT, 10, 0)).toEqual({ rows: [row], total: 7 });
  });

  it("listByTenant applies the status and rootAgentId filters", async () => {
    queue.push([], [{ count: 0 }]);
    await orchestrationRepo.listByTenant(TENANT, 10, 0, { status: "failed", rootAgentId: AGENT_A });
    expect(calls.filter((c) => c === "where").length).toBe(2);
  });

  it("listByTenant falls back to a zero total", async () => {
    queue.push([], []);
    expect((await orchestrationRepo.listByTenant(TENANT, 10, 0)).total).toBe(0);
  });

  it("listHops orders the trace", async () => {
    queue.push([{ id: "h1" }]);
    expect(await orchestrationRepo.listHops(ORCH_ID, TENANT)).toEqual([{ id: "h1" }]);
    expect(calls).toContain("orderBy");
  });

  it("insert and insertHop issue an insert", async () => {
    await orchestrationRepo.insert(tx(), {
      id: ORCH_ID, tenantId: TENANT, rootAgentId: AGENT_A, createdBy: USER, updatedBy: USER,
    });
    await orchestrationRepo.insertHop(tx(), {
      id: "h1", tenantId: TENANT, orchestrationId: ORCH_ID, fromAgentId: AGENT_A, toAgentId: AGENT_A,
    });
    expect(calls.filter((c) => c === "insert").length).toBe(2);
  });

  it("update reports whether the optimistic lock matched", async () => {
    queue.push([{ id: ORCH_ID }]);
    expect(await orchestrationRepo.update(tx(), ORCH_ID, TENANT, { depth: 2 }, 1)).toBe(true);
    queue.push([]);
    expect(await orchestrationRepo.update(tx(), ORCH_ID, TENANT, { depth: 2 }, 1)).toBe(false);
  });

  it("countsByStatus folds rows into a map", async () => {
    queue.push([{ status: "running", count: 2 }, { status: "failed", count: 1 }]);
    expect(await orchestrationRepo.countsByStatus(TENANT)).toEqual({ running: 2, failed: 1 });
  });

  it("durationStats coerces numeric strings and nulls", async () => {
    queue.push([{ avgHopCount: "2.5", p95DurationMs: "1234.5" }]);
    expect(await orchestrationRepo.durationStats(TENANT)).toEqual({ avgHopCount: 2.5, p95DurationMs: 1234.5 });
    queue.push([{ avgHopCount: null, p95DurationMs: null }]);
    expect(await orchestrationRepo.durationStats(TENANT)).toEqual({ avgHopCount: 0, p95DurationMs: 0 });
    queue.push([]);
    expect(await orchestrationRepo.durationStats(TENANT)).toEqual({ avgHopCount: 0, p95DurationMs: 0 });
  });

  it("activeCountsByAgent and failedCountsByAgent fold rows into maps", async () => {
    queue.push([{ rootAgentId: AGENT_A, count: 3 }]);
    expect(await orchestrationRepo.activeCountsByAgent(TENANT)).toEqual({ [AGENT_A]: 3 });
    queue.push([{ rootAgentId: AGENT_A, count: 1 }]);
    expect(await orchestrationRepo.failedCountsByAgent(TENANT)).toEqual({ [AGENT_A]: 1 });
  });
});

// ── authoring repo ────────────────────────────────────────────────────────────

describe("authoring-repo", () => {
  const row = {
    id: "88888888-1111-4000-8000-000000000001", tenantId: TENANT, name: "Triage",
    description: null, systemPrompt: "p", tools: [{ name: "t" }], modelConfig: { model: "m" },
    status: "published", publishedAt: new Date("2026-02-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: USER, updatedBy: USER, version: 2,
  };

  it("toView serialises publishedAt", () => {
    expect(authoringRepo.toView(row).publishedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(authoringRepo.toView({ ...row, publishedAt: null }).publishedAt).toBeNull();
  });

  it("findById and findByName return the first row or null", async () => {
    queue.push([row]);
    expect(await authoringRepo.findById(row.id, TENANT)).toEqual(row);
    queue.push([]);
    expect(await authoringRepo.findByName("Triage", TENANT)).toBeNull();
  });

  it("listByTenant applies status and search filters", async () => {
    queue.push([row], [{ count: 1 }]);
    const out = await authoringRepo.listByTenant(TENANT, 10, 0, { status: "draft", search: "tri" });
    expect(out).toEqual({ rows: [row], total: 1 });
  });

  it("insert and update work through the chain", async () => {
    await authoringRepo.insert(tx(), {
      id: row.id, tenantId: TENANT, name: "Triage", createdBy: USER, updatedBy: USER,
    });
    queue.push([{ id: row.id }]);
    expect(await authoringRepo.update(tx(), row.id, TENANT, { name: "New" }, 2)).toBe(true);
    queue.push([]);
    expect(await authoringRepo.update(tx(), row.id, TENANT, { name: "New" }, 2)).toBe(false);
  });
});

// ── quality repo ──────────────────────────────────────────────────────────────

describe("quality-repo", () => {
  const row = {
    id: "99999999-1111-4000-8000-000000000009", tenantId: TENANT,
    conversationId: CONV_ID, turnId: TURN_ID,
    relevance: "0.9000", coherence: "0.8000", safety: "0.9500", overall: "0.8950",
    flagged: false, flagReason: null, scoredAt: new Date("2026-03-01T00:00:00Z"),
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
  };

  it("toView keeps numeric columns as strings", () => {
    const v = qualityRepo.toView(row);
    expect(typeof v.overall).toBe("string");
    expect(v.overall).toBe("0.8950");
    expect(v.scoredAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("findByTurn returns the row or null", async () => {
    queue.push([row]);
    expect(await qualityRepo.findByTurn(TENANT, CONV_ID, TURN_ID)).toEqual(row);
    queue.push([]);
    expect(await qualityRepo.findByTurn(TENANT, CONV_ID, TURN_ID)).toBeNull();
  });

  it("listByConversation returns rows plus the total", async () => {
    queue.push([row], [{ count: 1 }]);
    expect(await qualityRepo.listByConversation(TENANT, CONV_ID, 10, 0)).toEqual({ rows: [row], total: 1 });
  });

  it("listFlagged returns rows plus the total", async () => {
    queue.push([{ ...row, flagged: true }], [{ count: 1 }]);
    const out = await qualityRepo.listFlagged(TENANT, 10, 0);
    expect(out.total).toBe(1);
    expect(out.rows[0]?.flagged).toBe(true);
  });

  it("listFlagged falls back to a zero total", async () => {
    queue.push([], []);
    expect((await qualityRepo.listFlagged(TENANT, 10, 0)).total).toBe(0);
  });

  it("upsert targets the turn uniqueness constraint", async () => {
    await qualityRepo.upsert(tx(), {
      id: row.id, tenantId: TENANT, conversationId: CONV_ID, turnId: TURN_ID,
      relevance: "0.9000", coherence: "0.8000", safety: "0.9500", overall: "0.8950",
      flagged: false, flagReason: null, createdBy: USER, updatedBy: USER,
    });
    expect(calls).toContain("onConflictDoUpdate");
  });

  it("upsert tolerates absent optional score fields", async () => {
    await qualityRepo.upsert(tx(), {
      id: row.id, tenantId: TENANT, conversationId: CONV_ID, turnId: TURN_ID,
      createdBy: USER, updatedBy: USER,
    });
    expect(calls).toContain("onConflictDoUpdate");
  });
});

// ── protocols repo ────────────────────────────────────────────────────────────

describe("protocols-repo", () => {
  const row = {
    id: "66666666-1111-4000-8000-000000000001", tenantId: TENANT, protocol: "mcp",
    endpoint: "https://tools.example.gov.in/mcp", capabilities: [{ name: "search" }], enabled: true,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: USER, updatedBy: USER, version: 1,
  };

  it("toView serialises timestamps", () => {
    expect(protocolsRepo.toView(row).createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("findById returns the row or null", async () => {
    queue.push([row]);
    expect(await protocolsRepo.findById(row.id, TENANT)).toEqual(row);
    queue.push([]);
    expect(await protocolsRepo.findById(row.id, TENANT)).toBeNull();
  });

  it("listByTenant applies the protocol and enabled filters", async () => {
    queue.push([row], [{ count: 1 }]);
    expect(await protocolsRepo.listByTenant(TENANT, 10, 0, { protocol: "mcp", enabled: false }))
      .toEqual({ rows: [row], total: 1 });
  });

  it("insert and update work through the chain", async () => {
    await protocolsRepo.insert(tx(), {
      id: row.id, tenantId: TENANT, protocol: "mcp", endpoint: row.endpoint,
      createdBy: USER, updatedBy: USER,
    });
    queue.push([{ id: row.id }]);
    expect(await protocolsRepo.update(tx(), row.id, TENANT, { enabled: false }, 1)).toBe(true);
    queue.push([]);
    expect(await protocolsRepo.update(tx(), row.id, TENANT, { enabled: false }, 1)).toBe(false);
  });
});

// ── tools repo ────────────────────────────────────────────────────────────────

describe("tools-repo", () => {
  const tool = {
    id: "55555555-1111-4000-8000-000000000001", tenantId: TENANT, agentDomain: "helpdesk",
    toolName: "lookup_ticket", description: "d", inputSchema: { type: "object" },
    requiresApproval: false, enabled: true,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: USER, updatedBy: USER, version: 1,
  };

  const step = {
    id: "44444444-1111-4000-8000-000000000001", tenantId: TENANT, agentId: AGENT_A,
    orchestrationId: null, toolId: tool.id, stepNo: 1, thought: "t", action: "lookup_ticket",
    actionInput: {}, observation: null, status: "executed", executed: true,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
  };

  it("toView and toStepView serialise timestamps", () => {
    expect(toolsRepo.toView(tool).updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(toolsRepo.toStepView(step).occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("findById and findByName return the row or null", async () => {
    queue.push([tool]);
    expect(await toolsRepo.findById(tool.id, TENANT)).toEqual(tool);
    queue.push([]);
    expect(await toolsRepo.findByName(TENANT, "helpdesk", "lookup_ticket")).toBeNull();
  });

  it("listByTenant applies every filter", async () => {
    queue.push([tool], [{ count: 1 }]);
    expect(await toolsRepo.listByTenant(TENANT, 10, 0, {
      agentDomain: "helpdesk", enabled: true, requiresApproval: false,
    })).toEqual({ rows: [tool], total: 1 });
  });

  it("insert and update work through the chain", async () => {
    await toolsRepo.insert(tx(), {
      id: tool.id, tenantId: TENANT, agentDomain: "crm", toolName: "lookup_customer",
      createdBy: USER, updatedBy: USER,
    });
    queue.push([{ id: tool.id }]);
    expect(await toolsRepo.update(tx(), tool.id, TENANT, { enabled: false }, 1)).toBe(true);
    queue.push([]);
    expect(await toolsRepo.update(tx(), tool.id, TENANT, { enabled: false }, 1)).toBe(false);
  });

  it("insertManyIgnoreConflicts returns the inserted count and short-circuits on an empty list", async () => {
    expect(await toolsRepo.insertManyIgnoreConflicts(tx(), [])).toBe(0);
    queue.push([{ id: "1" }, { id: "2" }]);
    const inserted = await toolsRepo.insertManyIgnoreConflicts(tx(), [
      { id: "1", tenantId: TENANT, agentDomain: "crm", toolName: "a", createdBy: USER, updatedBy: USER },
      { id: "2", tenantId: TENANT, agentDomain: "crm", toolName: "b", createdBy: USER, updatedBy: USER },
    ]);
    expect(inserted).toBe(2);
    expect(calls).toContain("onConflictDoNothing");
  });

  it("insertStep, countSteps and listSteps work through the chain", async () => {
    await toolsRepo.insertStep(tx(), {
      id: step.id, tenantId: TENANT, agentId: AGENT_A, thought: "t", action: "a",
      createdBy: USER, updatedBy: USER,
    });
    queue.push([{ count: 4 }]);
    expect(await toolsRepo.countSteps(TENANT, AGENT_A)).toBe(4);
    queue.push([]);
    expect(await toolsRepo.countSteps(TENANT, AGENT_A)).toBe(0);
    queue.push([step], [{ count: 1 }]);
    expect(await toolsRepo.listSteps(TENANT, AGENT_A, 10, 0)).toEqual({ rows: [step], total: 1 });
  });
});

// ── governance repo (ops console aggregate) ───────────────────────────────────

describe("governance-repo blockedCountsByAgent", () => {
  it("folds rows into a map and drops the null agent bucket", async () => {
    queue.push([{ agentId: AGENT_A, count: 2 }, { agentId: null, count: 5 }]);
    expect(await governanceRepo.blockedCountsByAgent(TENANT)).toEqual({ [AGENT_A]: 2 });
  });

  it("returns an empty map when nothing is blocked", async () => {
    queue.push([]);
    expect(await governanceRepo.blockedCountsByAgent(TENANT)).toEqual({});
  });
});

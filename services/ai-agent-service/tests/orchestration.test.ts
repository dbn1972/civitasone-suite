/**
 * AG-001 multi-agent orchestration — domain unit tests + route tests.
 * Explicitly covers depth-limit and hop-limit refusals (both 422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  canHandoff,
  normalizeLimits,
  summarizeHopTrace,
  validateOrchestrationTransition,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_HOPS,
} from "../src/modules/agents/orchestration-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const AGENT_A = "eeeeeeee-1111-4000-8000-000000000001";
const AGENT_B = "eeeeeeee-2222-4000-8000-000000000002";
const ORCH_ID = "77777777-1111-4000-8000-000000000001";

// ── DOMAIN: canHandoff ────────────────────────────────────────────────────────

describe("canHandoff", () => {
  const running = { status: "running", depth: 0, hopCount: 0 };

  it("allows a handoff well inside both budgets", () => {
    const d = canHandoff(running, 5, 20);
    expect(d).toMatchObject({ allowed: true, code: null, nextDepth: 1, nextHopCount: 1 });
  });

  it("allows the handoff that exactly reaches maxDepth", () => {
    expect(canHandoff({ status: "running", depth: 4, hopCount: 4 }, 5, 20).allowed).toBe(true);
  });

  it("refuses the handoff that would exceed maxDepth", () => {
    const d = canHandoff({ status: "running", depth: 5, hopCount: 5 }, 5, 20);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("DEPTH_LIMIT_EXCEEDED");
    expect(d.reason).toContain("maxDepth 5");
  });

  it("allows the handoff that exactly reaches maxHops", () => {
    expect(canHandoff({ status: "running", depth: 0, hopCount: 19 }, 5, 20).allowed).toBe(true);
  });

  it("refuses the handoff that would exceed maxHops even at depth 0 (ping-pong cycle)", () => {
    const d = canHandoff({ status: "running", depth: 0, hopCount: 20 }, 5, 20);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("HOP_LIMIT_EXCEEDED");
    expect(d.reason).toContain("maxHops 20");
  });

  it("checks depth before hops when both are exhausted", () => {
    const d = canHandoff({ status: "running", depth: 9, hopCount: 9 }, 5, 5);
    expect(d.code).toBe("DEPTH_LIMIT_EXCEEDED");
  });

  it("refuses a handoff on a non-running orchestration", () => {
    for (const status of ["completed", "failed", "aborted"]) {
      const d = canHandoff({ status, depth: 0, hopCount: 0 }, 5, 20);
      expect(d.allowed).toBe(false);
      expect(d.code).toBe("ORCHESTRATION_NOT_RUNNING");
    }
  });

  it("fails closed on non-positive or non-finite limits", () => {
    expect(canHandoff(running, 0, 20).code).toBe("LIMITS_INVALID");
    expect(canHandoff(running, 5, 0).code).toBe("LIMITS_INVALID");
    expect(canHandoff(running, -1, 20).code).toBe("LIMITS_INVALID");
    expect(canHandoff(running, Number.NaN, 20).code).toBe("LIMITS_INVALID");
    expect(canHandoff(running, 5, Number.POSITIVE_INFINITY).code).toBe("LIMITS_INVALID");
  });

  it("reports the counters the handoff would produce even when refused", () => {
    const d = canHandoff({ status: "running", depth: 5, hopCount: 7 }, 5, 20);
    expect(d.nextDepth).toBe(6);
    expect(d.nextHopCount).toBe(8);
  });
});

describe("validateOrchestrationTransition", () => {
  it("allows running → terminal states", () => {
    expect(validateOrchestrationTransition("running", "completed")).toBeNull();
    expect(validateOrchestrationTransition("running", "failed")).toBeNull();
    expect(validateOrchestrationTransition("running", "aborted")).toBeNull();
  });

  it("rejects transitions out of a terminal state", () => {
    expect(validateOrchestrationTransition("completed", "running")).toContain("cannot transition");
    expect(validateOrchestrationTransition("aborted", "aborted")).toContain("cannot transition");
  });

  it("rejects unknown statuses on either side", () => {
    expect(validateOrchestrationTransition("zombie", "running")).toContain("unknown");
    expect(validateOrchestrationTransition("running", "zombie")).toContain("unknown");
  });
});

describe("normalizeLimits", () => {
  it("applies defaults when nothing is supplied", () => {
    expect(normalizeLimits(undefined, undefined)).toEqual({
      maxDepth: DEFAULT_MAX_DEPTH,
      maxHops: DEFAULT_MAX_HOPS,
    });
  });

  it("clamps to the supported band", () => {
    expect(normalizeLimits(0, 0)).toEqual({ maxDepth: 1, maxHops: 1 });
    expect(normalizeLimits(1000, 1000)).toEqual({ maxDepth: 20, maxHops: 200 });
  });

  it("floors fractional values", () => {
    expect(normalizeLimits(3.9, 7.2)).toEqual({ maxDepth: 3, maxHops: 7 });
  });
});

describe("summarizeHopTrace", () => {
  it("returns zeros for an empty trace", () => {
    expect(summarizeHopTrace([])).toEqual({
      hopCount: 0, maxDepthReached: 0, distinctAgents: 0, cyclic: false,
    });
  });

  it("summarises a linear trace", () => {
    const s = summarizeHopTrace([
      { depth: 1, fromAgentId: "a", toAgentId: "b" },
      { depth: 2, fromAgentId: "b", toAgentId: "c" },
    ]);
    expect(s).toEqual({ hopCount: 2, maxDepthReached: 2, distinctAgents: 3, cyclic: false });
  });

  it("flags a repeated agent pair as cyclic", () => {
    const s = summarizeHopTrace([
      { depth: 1, fromAgentId: "a", toAgentId: "b" },
      { depth: 2, fromAgentId: "b", toAgentId: "a" },
      { depth: 3, fromAgentId: "a", toAgentId: "b" },
    ]);
    expect(s.cyclic).toBe(true);
    expect(s.distinctAgents).toBe(2);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  auditInsertMock: vi.fn(),
  agentFindByIdMock: vi.fn(),
  orchFindByIdMock: vi.fn(),
  orchInsertMock: vi.fn(),
  orchInsertHopMock: vi.fn(),
  orchUpdateMock: vi.fn(),
  orchListHopsMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: vi.fn(() => "cache-key"),
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/agents/repo.js", () => ({
  findById: (...a: unknown[]) => H.agentFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  listByStatus: vi.fn(async () => []),
  countByStatus: vi.fn(async () => 0),
  insert: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/agents/orchestration-repo.js", () => ({
  findById: (...a: unknown[]) => H.orchFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  listHops: (...a: unknown[]) => H.orchListHopsMock(...a),
  insert: (...a: unknown[]) => H.orchInsertMock(...a),
  insertHop: (...a: unknown[]) => H.orchInsertHopMock(...a),
  update: (...a: unknown[]) => H.orchUpdateMock(...a),
  countsByStatus: vi.fn(async () => ({})),
  durationStats: vi.fn(async () => ({ avgHopCount: 0, p95DurationMs: 0 })),
  activeCountsByAgent: vi.fn(async () => ({})),
  failedCountsByAgent: vi.fn(async () => ({})),
  toView: (r: Record<string, unknown>) => r,
  toHopView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/governance/repo.js", () => ({
  insert: (...a: unknown[]) => H.auditInsertMock(...a),
  findById: vi.fn(),
  listByTenant: vi.fn(),
  countTotals: vi.fn(),
  blockedCountsByAgent: vi.fn(async () => ({})),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (sub = USER, roles = ["ai_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeAgent(over: Record<string, unknown> = {}) {
  return { id: AGENT_A, tenantId: TENANT, name: "Router", skills: [], tools: [], status: "active", version: 1, ...over };
}

function makeOrchestration(over: Record<string, unknown> = {}) {
  return {
    id: ORCH_ID, tenantId: TENANT, rootAgentId: AGENT_A, status: "running",
    depth: 0, maxDepth: 5, hopCount: 0, maxHops: 20, reason: null,
    startedAt: new Date(), completedAt: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.auditInsertMock.mockResolvedValue(undefined);
  H.agentFindByIdMock.mockResolvedValue(makeAgent());
  H.orchInsertMock.mockResolvedValue(undefined);
  H.orchInsertHopMock.mockResolvedValue(undefined);
  H.orchUpdateMock.mockResolvedValue(true);
  H.orchListHopsMock.mockResolvedValue([]);
});

describe("POST /v1/ai/orchestrations", () => {
  it("202 — starts an orchestration with default limits", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(USER, ["ai_user"]),
      payload: { rootAgentId: AGENT_A },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data).toMatchObject({ status: "running", depth: 0, hopCount: 0, maxDepth: 5, maxHops: 20 });
    expect(H.orchInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("202 — honours explicit limits", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(),
      payload: { rootAgentId: AGENT_A, maxDepth: 2, maxHops: 3 },
    });
    expect(r.json().data).toMatchObject({ maxDepth: 2, maxHops: 3 });
    await app.close();
  });

  it("202 — emits orchestrationStarted and an audit entry", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(),
      payload: { rootAgentId: AGENT_A },
    });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.orchestration.started");
    expect(topics).toContain("audit.event.record");
    expect(H.auditInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — root agent does not exist", async () => {
    H.agentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(), payload: { rootAgentId: AGENT_A },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — root agent is paused", async () => {
    H.agentFindByIdMock.mockResolvedValue(makeAgent({ status: "paused" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(), payload: { rootAgentId: AGENT_A },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("AGENT_NOT_INVOCABLE");
    await app.close();
  });

  it("400 — rootAgentId is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(), payload: { rootAgentId: "nope" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — maxDepth above the schema ceiling (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(),
      payload: { rootAgentId: AGENT_A, maxDepth: 999 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", payload: { rootAgentId: AGENT_A },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/orchestrations", headers: auth(USER, ["viewer"]),
      payload: { rootAgentId: AGENT_A },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/ai/orchestrations/:id/handoff", () => {
  it("202 — records a hop and advances depth + hop count", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ depth: 1, hopCount: 3 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(USER, ["ai_user"]),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "needs billing expertise" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data).toMatchObject({ depth: 2, hopCount: 4, status: "handed_off" });
    expect(H.orchInsertHopMock).toHaveBeenCalledOnce();
    expect(H.orchUpdateMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("202 — emits orchestrationHopRecorded", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "escalate" },
    });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.orchestration.hop_recorded");
    await app.close();
  });

  it("422 DEPTH_LIMIT_EXCEEDED — depth budget exhausted", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ depth: 5, maxDepth: 5, hopCount: 5 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "deeper" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DEPTH_LIMIT_EXCEEDED");
    expect(r.json().details).toMatchObject({ depth: 5, maxDepth: 5 });
    // Nothing is persisted when the valve trips.
    expect(H.orchInsertHopMock).not.toHaveBeenCalled();
    expect(H.orchUpdateMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 HOP_LIMIT_EXCEEDED — hop budget exhausted at a legal depth", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ depth: 1, maxDepth: 5, hopCount: 20, maxHops: 20 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "one more time" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("HOP_LIMIT_EXCEEDED");
    expect(r.json().details).toMatchObject({ hopCount: 20, maxHops: 20 });
    expect(H.orchInsertHopMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — a refused handoff is audited and emits limitExceeded", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ depth: 5, maxDepth: 5 }));
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "deeper" },
    });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.orchestration.limit_exceeded");
    const row = H.auditInsertMock.mock.calls[0]?.[1] as { blocked: boolean; action: string };
    expect(row.blocked).toBe(true);
    expect(row.action).toBe("orchestration.handoff");
    await app.close();
  });

  it("422 — orchestration already aborted", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ status: "aborted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "x" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ORCHESTRATION_NOT_RUNNING");
    await app.close();
  });

  it("409 — concurrent modification loses the optimistic lock", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    H.orchUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "x" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("VERSION_CONFLICT");
    await app.close();
  });

  it("404 — unknown orchestration", async () => {
    H.orchFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "x" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — reason is required (zod)", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`,
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "x" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/handoff`, headers: auth(USER, ["viewer"]),
      payload: { fromAgentId: AGENT_A, toAgentId: AGENT_B, reason: "x" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/ai/orchestrations/:id/abort", () => {
  it("200 — aborts a running orchestration with a reason", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ version: 3 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(),
      payload: { reason: "runaway token spend" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({
      id: ORCH_ID, status: "aborted", reason: "runaway token spend", version: 4,
    });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.orchestration.aborted");
    await app.close();
  });

  it("400 — abort without a reason is rejected", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — an empty reason is rejected", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(), payload: { reason: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("422 — already completed", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ status: "completed" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(), payload: { reason: "x" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration());
    H.orchUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(),
      payload: { reason: "x", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("404 — unknown orchestration", async () => {
    H.orchFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(), payload: { reason: "x" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, payload: { reason: "x" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — abort requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/orchestrations/${ORCH_ID}/abort`, headers: auth(USER, ["ai_user"]),
      payload: { reason: "x" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/orchestrations/:id", () => {
  it("200 — returns state plus the full hop trace and a trace summary", async () => {
    H.orchFindByIdMock.mockResolvedValue(makeOrchestration({ depth: 2, hopCount: 2 }));
    H.orchListHopsMock.mockResolvedValue([
      { id: "h1", tenantId: TENANT, orchestrationId: ORCH_ID, fromAgentId: AGENT_A, toAgentId: AGENT_B, depth: 1, reason: "a", occurredAt: new Date(), version: 1 },
      { id: "h2", tenantId: TENANT, orchestrationId: ORCH_ID, fromAgentId: AGENT_B, toAgentId: AGENT_A, depth: 2, reason: "b", occurredAt: new Date(), version: 1 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/orchestrations/${ORCH_ID}`, headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.hops).toHaveLength(2);
    expect(r.json().data.trace).toMatchObject({ hopCount: 2, maxDepthReached: 2, distinctAgents: 2 });
    await app.close();
  });

  it("404 — unknown orchestration", async () => {
    H.orchFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/orchestrations/${ORCH_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — id is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/orchestrations/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/orchestrations/${ORCH_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/orchestrations/${ORCH_ID}`, headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

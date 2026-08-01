/**
 * AG-002 agent operations console — domain unit tests + route tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  buildAgentOpsRow,
  buildOpsSummary,
  deriveLiveStatus,
} from "../src/modules/agents/ops-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const AGENT_A = "eeeeeeee-1111-4000-8000-000000000001";

// ── DOMAIN ────────────────────────────────────────────────────────────────────

describe("deriveLiveStatus", () => {
  it("idle when nothing is running and nothing failed", () => {
    expect(deriveLiveStatus({ status: "active", activeOrchestrations: 0, errorCount: 0 })).toBe("idle");
  });

  it("busy when orchestrations are in flight", () => {
    expect(deriveLiveStatus({ status: "active", activeOrchestrations: 2, errorCount: 0 })).toBe("busy");
  });

  it("degraded outranks busy so failures are never hidden", () => {
    expect(deriveLiveStatus({ status: "active", activeOrchestrations: 9, errorCount: 1 })).toBe("degraded");
  });

  it("lifecycle status wins: a paused agent reads paused even when busy", () => {
    expect(deriveLiveStatus({ status: "paused", activeOrchestrations: 3, errorCount: 4 })).toBe("paused");
  });

  it("archived reads archived", () => {
    expect(deriveLiveStatus({ status: "archived", activeOrchestrations: 0, errorCount: 7 })).toBe("archived");
  });
});

describe("buildAgentOpsRow", () => {
  it("preserves the input and appends the derived live status", () => {
    expect(buildAgentOpsRow({ id: "a", name: "Bot", status: "active", activeOrchestrations: 1, errorCount: 0 }))
      .toEqual({ id: "a", name: "Bot", status: "active", activeOrchestrations: 1, errorCount: 0, liveStatus: "busy" });
  });
});

describe("buildOpsSummary", () => {
  it("totals the counters and computes the failure rate", () => {
    const s = buildOpsSummary({ running: 2, completed: 5, failed: 2, aborted: 1, avgHopCount: 3.456, p95DurationMs: 1234.7 });
    expect(s).toEqual({
      running: 2, completed: 5, failed: 2, aborted: 1, total: 10,
      avgHopCount: 3.46, p95DurationMs: 1235, failureRatePct: 20,
    });
  });

  it("zero total yields a 0% failure rate, not NaN", () => {
    const s = buildOpsSummary({ running: 0, completed: 0, failed: 0, aborted: 0, avgHopCount: 0, p95DurationMs: 0 });
    expect(s.total).toBe(0);
    expect(s.failureRatePct).toBe(0);
  });

  it("coerces non-finite and negative inputs to zero", () => {
    const s = buildOpsSummary({
      running: Number.NaN, completed: -3, failed: 1, aborted: 0,
      avgHopCount: Number.POSITIVE_INFINITY, p95DurationMs: Number.NaN,
    });
    expect(s.running).toBe(0);
    expect(s.completed).toBe(0);
    expect(s.avgHopCount).toBe(0);
    expect(s.p95DurationMs).toBe(0);
    expect(s.failureRatePct).toBe(100);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  agentListMock: vi.fn(),
  orchListMock: vi.fn(),
  countsByStatusMock: vi.fn(),
  durationStatsMock: vi.fn(),
  activeCountsMock: vi.fn(),
  blockedCountsMock: vi.fn(),
  getOrLoadMock: vi.fn(),
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
    getOrLoad: (...a: unknown[]) => H.getOrLoadMock(...a),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (t: string, resource: string, id: string) => `ai-agent:${t}:${resource}:${id}`,
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/agents/repo.js", () => ({
  findById: vi.fn(),
  listByTenant: (...a: unknown[]) => H.agentListMock(...a),
  listByStatus: vi.fn(async () => []),
  countByStatus: vi.fn(async () => 0),
  insert: vi.fn(), update: vi.fn(), archive: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/agents/orchestration-repo.js", () => ({
  findById: vi.fn(),
  listByTenant: (...a: unknown[]) => H.orchListMock(...a),
  listHops: vi.fn(async () => []),
  insert: vi.fn(), insertHop: vi.fn(), update: vi.fn(),
  countsByStatus: (...a: unknown[]) => H.countsByStatusMock(...a),
  durationStats: (...a: unknown[]) => H.durationStatsMock(...a),
  activeCountsByAgent: (...a: unknown[]) => H.activeCountsMock(...a),
  failedCountsByAgent: vi.fn(async () => ({})),
  toView: (r: Record<string, unknown>) => r,
  toHopView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/governance/repo.js", () => ({
  insert: vi.fn(),
  findById: vi.fn(),
  listByTenant: vi.fn(),
  countTotals: vi.fn(),
  blockedCountsByAgent: (...a: unknown[]) => H.blockedCountsMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (sub = USER, roles = ["ai_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  // Cache-first: the loader is only invoked on a miss, which is what these tests exercise.
  H.getOrLoadMock.mockImplementation(async (_k: string, loader: () => Promise<unknown>) => loader());
  H.agentListMock.mockResolvedValue({ rows: [], total: 0 });
  H.orchListMock.mockResolvedValue({ rows: [], total: 0 });
  H.countsByStatusMock.mockResolvedValue({});
  H.durationStatsMock.mockResolvedValue({ avgHopCount: 0, p95DurationMs: 0 });
  H.activeCountsMock.mockResolvedValue({});
  H.blockedCountsMock.mockResolvedValue({});
});

describe("GET /v1/ai/ops/agents", () => {
  it("200 — every agent with live status and activity counters", async () => {
    H.agentListMock.mockResolvedValue({
      rows: [{ id: AGENT_A, name: "Router", status: "active" }],
      total: 1,
    });
    H.activeCountsMock.mockResolvedValue({ [AGENT_A]: 2 });
    H.blockedCountsMock.mockResolvedValue({ [AGENT_A]: 1 });

    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents", headers: auth(USER, ["audit_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0]).toEqual({
      id: AGENT_A, name: "Router", status: "active",
      activeOrchestrations: 2, errorCount: 1, liveStatus: "degraded",
    });
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — reads go through the cache", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/ops/agents", headers: auth() });
    expect(H.getOrLoadMock).toHaveBeenCalledOnce();
    expect(H.getOrLoadMock.mock.calls[0]?.[0]).toContain("ops-agents");
    await app.close();
  });

  it("200 — a cache hit does not touch the repos", async () => {
    H.getOrLoadMock.mockResolvedValue({ data: [], total: 4 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents", headers: auth() });
    expect(r.json().meta.total).toBe(4);
    expect(H.agentListMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("200 — passes the status filter through", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/ops/agents?status=paused&limit=10&offset=10", headers: auth() });
    expect(H.agentListMock).toHaveBeenCalledWith(TENANT, 10, 10, { status: "paused" });
    await app.close();
  });

  it("400 — invalid status filter (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents?status=zombie", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents?limit=201", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/agents", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/ops/orchestrations", () => {
  it("200 — paginated list", async () => {
    H.orchListMock.mockResolvedValue({ rows: [{ id: "o1", status: "running" }], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/ai/ops/orchestrations?limit=25&offset=25", headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 2, pageSize: 25, total: 1 });
    await app.close();
  });

  it("200 — filters by status and rootAgentId", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET", url: `/v1/ai/ops/orchestrations?status=failed&rootAgentId=${AGENT_A}`, headers: auth(),
    });
    expect(H.orchListMock).toHaveBeenCalledWith(TENANT, 50, 0, { status: "failed", rootAgentId: AGENT_A });
    await app.close();
  });

  it("400 — unknown status filter (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/orchestrations?status=paused", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — rootAgentId must be a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/orchestrations?rootAgentId=abc", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/orchestrations" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/ai/ops/orchestrations", headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/ops/summary", () => {
  it("200 — tenant counters, avg hops and p95 duration", async () => {
    H.countsByStatusMock.mockResolvedValue({ running: 1, completed: 3, failed: 1, aborted: 0 });
    H.durationStatsMock.mockResolvedValue({ avgHopCount: 2.5, p95DurationMs: 4321.9 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/summary", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({
      running: 1, completed: 3, failed: 1, aborted: 0, total: 5,
      avgHopCount: 2.5, p95DurationMs: 4322, failureRatePct: 20,
    });
    await app.close();
  });

  it("200 — empty tenant returns zeroed counters", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/summary", headers: auth() });
    expect(r.json().data).toMatchObject({ total: 0, failureRatePct: 0 });
    await app.close();
  });

  it("200 — read is cache-first", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/ops/summary", headers: auth() });
    expect(H.getOrLoadMock.mock.calls[0]?.[0]).toContain("ops-summary");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/summary" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/ops/summary", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

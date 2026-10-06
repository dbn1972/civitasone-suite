/**
 * Works dashboard route tests — GET /v1/works/dashboard.
 *
 * GAP-WORKS-HOME-02: pins the exact `byStatus` keys the dashboard returns to
 * the real proposal status vocabulary (draft | dao_finalized | ts_eligible,
 * per modules/proposal/schema.ts). The web hub (apps/web .../works/page.tsx)
 * derives its "Pending" KPI from these keys; a mismatch silently shows 0.
 *
 * GAP-WORKS-HOME-06: the audit snapshot claimed works-service was absent and
 * dashboard auth/validation/shape were "cannot-verify". The service IS present
 * here — these tests verify the reader-role gate (403 for a role outside
 * READ_ROLES) and the documented {data:{totalWorks,activeWorks,closedWorks,
 * byStatus}} response shape.
 *
 * DB-free: repos are mocked (same pattern as reporting-aggregates.test.ts) so
 * the test exercises the route handler, auth gate and response contract
 * without a live Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const countProposals = vi.fn();
const countClosures = vi.fn();
const proposalStatusCounts = vi.fn();

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, countProposals, proposalStatusCounts, getProposal: vi.fn(async () => null) };
});
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, countClosures };
});
vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn(), select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: () => unknown) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad(_k: string, fn: () => unknown) { return fn(); } invalidate() { return Promise.resolve(); } },
}));
vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn(); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn(), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));
vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: { setErrorHandler: (h: unknown) => void }, HttpError: new (...a: unknown[]) => Error) => {
    app.setErrorHandler((err: { status?: number; code?: string }, _req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      if (err instanceof HttpError) return reply.status((err as { status: number }).status).send({ error: { code: (err as { code: string }).code } });
      return reply.status(500).send({ error: { code: "INTERNAL" } });
    });
  },
}));
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: {
    decorateRequest: (k: string, v: unknown) => void;
    addHook: (h: string, fn: (req: { headers?: Record<string, string>; ctx?: unknown }) => Promise<void>) => void;
  }) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      const [, body] = auth.replace("Bearer ", "").split(".");
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      (req as { ctx?: unknown }).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));
vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: { ctx?: unknown }) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing"); return req.ctx; },
    AuthContextError,
  };
});
vi.mock("@civitasone/auth", () => ({
  signToken: vi.fn(),
  hasAnyRole: (ctx: { roles?: string[] }, roles: string[]) => roles.some((r) => ctx.roles?.includes(r)),
}));

/** The canonical proposal status vocabulary (modules/proposal/schema.ts). */
const STATUS_VOCAB = ["draft", "dao_finalized", "ts_eligible"] as const;

describe("GET /v1/works/dashboard", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    countProposals.mockReset();
    countClosures.mockReset();
    proposalStatusCounts.mockReset();
  });

  it("GAP-WORKS-HOME-06: 403 for a role outside the works reader set", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/dashboard",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["citizen"]))}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    // guard runs before any repo read
    expect(countProposals).not.toHaveBeenCalled();
  });

  it("GAP-WORKS-HOME-06: 401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("GAP-WORKS-HOME-06: 200 with the documented shape for a valid reader", async () => {
    countProposals.mockResolvedValue(10);
    countClosures.mockResolvedValue(4);
    proposalStatusCounts.mockResolvedValue([{ status: "draft", count: 6 }]);
    const res = await app.inject({
      method: "GET", url: "/v1/works/dashboard",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toEqual({ totalWorks: 10, activeWorks: 6, closedWorks: 4, byStatus: { draft: 6 } });
    expect(countProposals).toHaveBeenCalledWith(TENANT_A);
  });

  it("GAP-WORKS-HOME-02: byStatus keys are the real proposal status vocabulary, passed through verbatim", async () => {
    countProposals.mockResolvedValue(9);
    countClosures.mockResolvedValue(0);
    proposalStatusCounts.mockResolvedValue([
      { status: "draft", count: 4 },
      { status: "dao_finalized", count: 3 },
      { status: "ts_eligible", count: 2 },
    ]);
    const res = await app.inject({
      method: "GET", url: "/v1/works/dashboard",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
    });
    expect(res.statusCode).toBe(200);
    const byStatus = res.json().data.byStatus;
    expect(Object.keys(byStatus).sort()).toEqual([...STATUS_VOCAB].sort());
    // the hub reads "submitted"/"pending" historically — prove those are NOT keys
    expect(byStatus).not.toHaveProperty("submitted");
    expect(byStatus).not.toHaveProperty("pending");
    // and the per-status counts are passed through unchanged
    expect(byStatus).toEqual({ draft: 4, dao_finalized: 3, ts_eligible: 2 });
  });

  it("GAP-WORKS-HOME-06: activeWorks never goes negative when closed > total", async () => {
    countProposals.mockResolvedValue(2);
    countClosures.mockResolvedValue(9);
    proposalStatusCounts.mockResolvedValue([]);
    const res = await app.inject({
      method: "GET", url: "/v1/works/dashboard",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
    });
    expect(res.json().data.activeWorks).toBe(0);
  });
});

/**
 * Reporting aggregate tests — summary/status reports reconcile to repo counts
 * and enforce tenant-scoped reads (no cross-tenant leakage via repo calls).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, TENANT_B, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const countProposals = vi.fn();
const countClosures = vi.fn();
const proposalStatusCounts = vi.fn();

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return {
    ...orig,
    countProposals,
    proposalStatusCounts,
    getProposal: vi.fn(async () => null),
  };
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
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad(_k: string, fn: Function) { return fn(); } invalidate() { return Promise.resolve(); } },
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
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code } });
      return reply.status(500).send({ error: { code: "INTERNAL" } });
    });
  },
}));
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      const [, body] = auth.replace("Bearer ", "").split(".");
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));
vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing"); return req.ctx; },
    AuthContextError,
  };
});
vi.mock("@civitasone/auth", () => ({
  signToken: vi.fn(),
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));

describe("Reporting aggregates", () => {
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

  it("summary report: activeWorks = totalWorks - closedWorks", async () => {
    countProposals.mockResolvedValue(50);
    countClosures.mockResolvedValue(12);
    const res = await app.inject({
      method: "GET", url: "/v1/works/reports/summary",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.totalWorks).toBe(50);
    expect(body.closedWorks).toBe(12);
    expect(body.activeWorks).toBe(38);
    expect(countProposals).toHaveBeenCalledWith(TENANT_A);
    expect(countClosures).toHaveBeenCalledWith(TENANT_A);
  });

  it("summary report: activeWorks never negative when closed > total", async () => {
    countProposals.mockResolvedValue(5);
    countClosures.mockResolvedValue(20);
    const res = await app.inject({
      method: "GET", url: "/v1/works/reports/summary",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
    });
    expect(res.json().data.activeWorks).toBe(0);
  });

  it("status report returns repo status counts for the authenticated tenant", async () => {
    const statusData = [{ status: "draft", count: 10 }, { status: "dao_finalized", count: 5 }];
    proposalStatusCounts.mockResolvedValue(statusData);
    const res = await app.inject({
      method: "GET", url: "/v1/works/reports/status",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(statusData);
    expect(proposalStatusCounts).toHaveBeenCalledWith(TENANT_A);
    expect(proposalStatusCounts).not.toHaveBeenCalledWith(TENANT_B);
  });

  it("status report for tenant B uses tenant B scope only", async () => {
    proposalStatusCounts.mockResolvedValue([]);
    await app.inject({
      method: "GET", url: "/v1/works/reports/status",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_B, ["works_viewer"]))}` },
    });
    expect(proposalStatusCounts).toHaveBeenCalledWith(TENANT_B);
  });

  it("reports are read-only (GET only — no mutation endpoints in reporting/routes.ts)", async () => {
    // N/A for POST — reporting module exposes only GET /summary and GET /status
    // per src/modules/reporting/routes.ts:8-32
    const res = await app.inject({
      method: "POST", url: "/v1/works/reports/summary",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

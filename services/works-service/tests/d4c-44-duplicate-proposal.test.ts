/**
 * Owner decision D4c #44: GET /proposals/duplicate-check warns about a likely duplicate (read roles only, tenant
 * scoped, validated query); creating a proposal is NOT blocked by one.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const findLikelyDuplicates = vi.fn();
vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, findLikelyDuplicates };
});
const publishProposalCreate = vi.fn(async () => "new-id");
vi.mock("../src/modules/proposal/commands.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/commands.js")>();
  return { ...orig, publishProposalCreate };
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
// NOTE: @civitasone/schemas/plugin is intentionally NOT mocked -- the real createFastifyErrorHandler runs, so every
// `.json().code` below is read from the FLAT { code, message, correlationId, retryable } body the service really sends.
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

describe("D4c #44 duplicate proposal warning", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const as = (role: string) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, [role]))}` });
  const url = (q: string) => `/v1/works/proposals/duplicate-check?${q}`;
  beforeEach(() => { findLikelyDuplicates.mockReset(); publishProposalCreate.mockClear(); });

  it("returns the likely duplicates and the financial year, tenant scoped", async () => {
    findLikelyDuplicates.mockResolvedValue([{ id: "p1", workNumber: "W/1", status: "draft", createdAt: new Date("2026-05-01T00:00:00Z") }]);
    const res = await app.inject({ method: "GET", url: url("description=Road%20repair&category=regular&district=Pune"), headers: as("works_viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.duplicates).toHaveLength(1);
    expect(res.json().data.duplicates[0]).toMatchObject({ id: "p1", workNumber: "W/1" });
    expect(res.json().data.financialYear).toMatch(/^\d{4}-\d{2}$/);
    expect(findLikelyDuplicates.mock.calls[0]![0]).toBe(TENANT_A);
    expect(findLikelyDuplicates.mock.calls[0]![1]).toMatchObject({ description: "Road repair", category: "regular", district: "Pune" });
  });

  it("an empty result is an empty list, not an error", async () => {
    findLikelyDuplicates.mockResolvedValue([]);
    const res = await app.inject({ method: "GET", url: url("description=Anything&category=deposit"), headers: as("works_operator") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.duplicates).toEqual([]);
  });

  it("requires a title and a valid category (400) and a works read role (403)", async () => {
    expect((await app.inject({ method: "GET", url: url("category=regular"), headers: as("works_viewer") })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: url("description=x&category=nope"), headers: as("works_viewer") })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: url("description=x&category=regular"), headers: as("citizen") })).statusCode).toBe(403);
    expect(findLikelyDuplicates).not.toHaveBeenCalled();
  });

  it("creating a proposal is never blocked by a duplicate (warn, do not block)", async () => {
    findLikelyDuplicates.mockResolvedValue([{ id: "p1", workNumber: "W/1", status: "draft", createdAt: new Date() }]);
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals", headers: as("works_operator"),
      payload: { description: "Road repair", category: "regular", workTypeId: "00000000-1111-4000-8000-0000000000aa", estimatedCostMinor: "100" },
    });
    expect(res.statusCode).toBe(202);
    expect(publishProposalCreate).toHaveBeenCalledTimes(1);
  });
});

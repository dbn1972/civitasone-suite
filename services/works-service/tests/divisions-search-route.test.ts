/**
 * GAP-WORKS-REPORTS-01 — GET /v1/works/masters/divisions/search route.
 *
 * Route-level test following the service's mocked-repo harness (same shape as
 * tests/boq-index-recap-sr.test.ts): asserts the reader-role gate and that the
 * route is wired to searchDivisions with the parsed q/limit. The DB behaviour
 * itself is proven separately in tests/divisions-search.db.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const searchDivisions = vi.fn();

vi.mock("../src/modules/masters/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/masters/repo.js")>();
  return { ...orig, searchDivisions };
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
      if (err?.name === "ZodError" || err?.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
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

const DIV_ID = "00000000-5555-4000-8000-0000000000d1";

describe("GET /v1/works/masters/divisions/search", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const auth = (roles: string[]) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles))}` });

  it("is forbidden without a reader role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/divisions/search?q=ngp", headers: auth(["unrelated_role"]) });
    expect(res.statusCode).toBe(403);
    expect(searchDivisions).not.toHaveBeenCalled();
  });

  it("returns divisions for a reader and passes the parsed q/limit", async () => {
    searchDivisions.mockResolvedValue([
      { id: DIV_ID, name: "Nagpur PWD Division", code: "NGP-PWD", officeType: "division" },
    ]);
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/divisions/search?q=nagpur&limit=5", headers: auth(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].code).toBe("NGP-PWD");
    expect(searchDivisions).toHaveBeenCalledWith(TENANT_A, "nagpur", 5);
  });

  it("defaults q to empty and limit to 20 when omitted", async () => {
    searchDivisions.mockResolvedValue([]);
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/divisions/search", headers: auth(["estimator"]) });
    expect(res.statusCode).toBe(200);
    expect(searchDivisions).toHaveBeenCalledWith(TENANT_A, "", 20);
  });
});

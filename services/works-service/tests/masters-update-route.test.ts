/**
 * GAP-WORKS-MASTERS-04: PATCH /v1/works/masters/:type/:id (update / deactivate).
 * Asserts the NEW route's behaviour:
 *   - admin-only (same gate as POST): viewer → 403
 *   - unknown id → 404
 *   - stale version → 409 VERSION_CONFLICT
 *   - matching version → 202 accepted (publishes works.master.update)
 * Mirrors tests/all-routes.test.ts's buildApp + inject harness, trimmed, with a
 * controllable getMaster so the version/not-found branches can be exercised.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn((fn: Function) => fn({})) },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));

vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad(_k: string, fn: Function) { return fn(); } invalidate() { return Promise.resolve(); } },
}));

// Controllable master row: id "00000000-...-known" exists at version 3.
const KNOWN = "00000000-3333-4000-8000-000000000001";
vi.mock("../src/modules/masters/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/masters/repo.js")>();
  return {
    ...orig,
    getMaster: vi.fn(async (_table: unknown, _tenant: string, id: string) =>
      id === KNOWN ? { id: KNOWN, name: "Existing", code: "EX", active: true, version: 3 } : null),
  };
});

vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn().mockResolvedValue(undefined); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));

vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: { _: { name: "messages" } }, processed: { _: { name: "processed" } }, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn().mockResolvedValue(true), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      if (err.name === "ZodError" || err.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.message } });
      return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
    });
  },
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      try {
        const [, body] = auth.replace("Bearer ", "").split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
      } catch { /* leave ctx null */ }
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number; code: string;
    constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; }
  }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token"); return req.ctx; },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", () => ({
  signToken: (p: any, _s: string, exp: number) => "x",
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r) => ctx.roles?.includes(r)),
}));

const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
function authHeader(roles: string[] = ["works_admin", "super_admin"]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.sig` };
}

let app: FastifyInstance;
beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("PATCH /v1/works/masters/:type/:id — GAP-WORKS-MASTERS-04", () => {
  it("403 for a works_viewer (admin-only, same gate as POST)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/works/masters/authorities/${KNOWN}`,
      headers: authHeader(["works_viewer"]), payload: { active: false, version: 3 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 with no token", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/works/masters/authorities/${KNOWN}`, payload: { active: false, version: 3 } });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown id", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/works/masters/authorities/00000000-0000-4000-8000-000000000000",
      headers: authHeader(), payload: { active: false, version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("409 VERSION_CONFLICT when the supplied version is stale", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/works/masters/authorities/${KNOWN}`,
      headers: authHeader(), payload: { name: "Renamed", version: 2 }, // current is 3
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_CONFLICT");
  });

  it("400 when no editable field is provided (only version)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/works/masters/authorities/${KNOWN}`,
      headers: authHeader(), payload: { version: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("202 accepted on a matching version (deactivate)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/works/masters/authorities/${KNOWN}`,
      headers: authHeader(), payload: { active: false, version: 3 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(KNOWN);
  });
});

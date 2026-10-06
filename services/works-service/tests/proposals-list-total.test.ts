/**
 * GAP-WORKS-PROPOSALS-06: GET /v1/works/proposals must report the TRUE total
 * row count in meta.total, not `data.length`. The old handler set
 * `total: data.length`, so with 250 proposals and the default pageSize=20 a
 * client reading meta.total was told there were only 20 — silent truncation
 * with no way to know more rows existed, exactly as GAP-WORKS-ORDERS-06 found
 * for the /work-orders alias. Mirrors work-orders-total.test.ts's harness.
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
  Cache: class {
    getOrLoad(_k: string, fn: Function) { return fn(); }
    invalidate() { return Promise.resolve(); }
  },
}));

const PAGE_ROWS = Array.from({ length: 20 }, (_v, i) => ({
  id: `00000000-1111-4000-8000-0000000000${String(i).padStart(2, "0")}`,
  workNumber: `WRK/2026/${i}`,
  status: "draft",
}));

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return {
    ...orig,
    listProposals: vi.fn(async () => PAGE_ROWS),
    countProposals: vi.fn(async () => 250),
    getProposal: vi.fn(async () => null),
    searchProposals: vi.fn(async () => []),
    resolveProposals: vi.fn(async () => []),
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
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return;
        (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: req.id || "c", sessionId: "s", actorType: "user" };
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
  signToken: (p: any, _s: string, exp: number) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + exp })).toString("base64url");
    return `${header}.${body}.${Buffer.from("sig").toString("base64url")}`;
  },
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r) => ctx.roles?.includes(r)),
}));

const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
function authHeader(roles: string[] = ["works_admin", "super_admin"]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("GET /v1/works/proposals — GAP-WORKS-PROPOSALS-06 true total", () => {
  it("meta.total reflects the full tenant count (250), NOT the page length (20)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals?pageSize=20", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(20);
    expect(body.meta.total).toBe(250);
    expect(body.meta.total).not.toBe(body.data.length);
  });
});

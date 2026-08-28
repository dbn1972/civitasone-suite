/**
 * Regression test: GET /v1/works/boq/:workId used to accept ANY workId,
 * real or not, and always return 200 { data: [] } for one with no items —
 * indistinguishable from a genuinely nonexistent work. Confirmed live during
 * the works deep-verify pass: GET /v1/works/boq/<random-uuid> through the
 * gateway returned HTTP 200 {"data":[]}. Because the frontend
 * (apps/web/.../works/boq/[workId]/page.tsx) only 404s when BOTH the items
 * call and the recapitulation call report a fetch failure, and the items
 * call never failed, a bogus /works/boq/<id> URL rendered a normal (empty)
 * BoQ page instead of a clean 404 — this is the L1 "detail routes 404
 * cleanly for a bogus id" check. Fix: the route now checks the work exists
 * (mirrors every other :id detail route in this service) before listing.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getProposal = vi.fn();
const listBoqItems = vi.fn();
const getRecapitulation = vi.fn();

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, getProposal };
});

vi.mock("../src/modules/boq/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/boq/repo.js")>();
  return { ...orig, listBoqItems, getRecapitulation };
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

describe("GET /v1/works/boq/:workId — validates the work exists", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  it("404s for a workId that does not correspond to any real work (was: 200 + [])", async () => {
    getProposal.mockResolvedValue(null); // no such proposal/work
    const res = await app.inject({
      method: "GET",
      url: "/v1/works/boq/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(404);
    expect(listBoqItems).not.toHaveBeenCalled(); // never even queries items for a nonexistent work
  });

  it("returns 200 with the real items (including an empty list) for a work that exists", async () => {
    getProposal.mockResolvedValue({ id: WORK_ID, status: "dao_finalized" });
    listBoqItems.mockResolvedValue([]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/works/boq/${WORK_ID}`,
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
    expect(listBoqItems).toHaveBeenCalledWith(TENANT_A, WORK_ID);
  });
});

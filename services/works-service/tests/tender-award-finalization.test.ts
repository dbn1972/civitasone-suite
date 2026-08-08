/**
 * Tender award two-level finalization — domain guards (canDao/canDo) and
 * route-level 422 blocking for out-of-sequence or terminal-state awards.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  canDaoFinalizeAward,
  canDoFinalizeAward,
  resolveApprovingAuthority,
} from "../src/modules/tender/domain.js";

const awardStore: Record<string, { id: string; status: string }> = {};

vi.mock("../src/modules/tender/repo.js", () => ({
  getAwardById: vi.fn(async (_tenantId: string, id: string) => awardStore[id] ?? null),
  listTenders: vi.fn(async () => []),
}));

// Reuse minimal app harness from all-routes pattern
vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: {
      transaction: vi.fn((fn: Function) => fn({
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      })),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class {
    getOrLoad(_k: string, fn: Function) { return Promise.resolve(fn()); }
    invalidate() { return Promise.resolve(); }
  },
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
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      if (err.name === "ZodError" || err.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
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

function token(roles: string[]) {
  const body = Buffer.from(JSON.stringify({ sub: "a", tid: "t", roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `h.${body}.s`;
}

describe("canDaoFinalizeAward / canDoFinalizeAward (domain)", () => {
  it("DAO finalize allowed only from draft", () => {
    expect(canDaoFinalizeAward("draft").allowed).toBe(true);
    expect(canDaoFinalizeAward("dao_finalized").allowed).toBe(false);
    expect(canDaoFinalizeAward("do_finalized").allowed).toBe(false);
  });

  it("DO finalize allowed only from dao_finalized", () => {
    expect(canDoFinalizeAward("dao_finalized").allowed).toBe(true);
    expect(canDoFinalizeAward("draft").allowed).toBe(false);
    expect(canDoFinalizeAward("do_finalized").allowed).toBe(false);
  });

  it("authority routing separates tiers at exact threshold boundaries", () => {
    expect(resolveApprovingAuthority(500_000_00n)).toBe("section_officer");
    expect(resolveApprovingAuthority(500_001_00n)).toBe("sdo");
    expect(resolveApprovingAuthority(25_00_001_00n)).toBe("do");
    expect(resolveApprovingAuthority(1_00_00_001_00n)).toBe("dao");
  });
});

describe("Award finalization route guards", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  it("POST dao-finalize → 422 when award is already dao_finalized", async () => {
    const id = "00000000-aaaa-4000-8000-000000000001";
    awardStore[id] = { id, status: "dao_finalized" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${id}/dao-finalize`,
      headers: { authorization: `Bearer ${token(["dao", "super_admin"])}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("FINALIZATION_BLOCKED");
  });

  it("POST do-finalize → 422 when award is still draft (skipped DAO step)", async () => {
    const id = "00000000-aaaa-4000-8000-000000000002";
    awardStore[id] = { id, status: "draft" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${id}/do-finalize`,
      headers: { authorization: `Bearer ${token(["do", "super_admin"])}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it("POST do-finalize → 422 when award is terminal do_finalized", async () => {
    const id = "00000000-aaaa-4000-8000-000000000003";
    awardStore[id] = { id, status: "do_finalized" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${id}/do-finalize`,
      headers: { authorization: `Bearer ${token(["do", "super_admin"])}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it("POST dao-finalize → 403 for section_officer (authority separation)", async () => {
    const id = "00000000-aaaa-4000-8000-000000000004";
    awardStore[id] = { id, status: "draft" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${id}/dao-finalize`,
      headers: { authorization: `Bearer ${token(["section_officer"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST do-finalize → 202 when award is dao_finalized", async () => {
    const id = "00000000-aaaa-4000-8000-000000000005";
    awardStore[id] = { id, status: "dao_finalized" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${id}/do-finalize`,
      headers: { authorization: `Bearer ${token(["do", "super_admin"])}` },
    });
    expect(res.statusCode).toBe(202);
  });
});

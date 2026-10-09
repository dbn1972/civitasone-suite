/**
 * Review-2 route-level acceptance tests for U11-works.
 *
 *  - GAP2-WORKS-APPROVALS-01: AA/TS finalize must reject a self-finalize
 *    (creator === finalizer) with 422 SELF_APPROVAL_FORBIDDEN; a different
 *    actor succeeds (202). Fails on the old code, which had no maker-checker.
 *  - GAP2-WORKS-TENDERS-04: award DAO/DO finalize must reject when the
 *    finalizer created the award (DAO) or performed the prior DAO finalize
 *    (DO) with 422 SELF_APPROVAL_FORBIDDEN.
 *  - GAP2-WORKS-APPROVALS-05: GET /approvals/aa|ts and /billing/bills return
 *    the TRUE tenant total in meta.total, not data.length.
 *  - GAP2-WORKS-CLOSURE-06: GET /closure returns the true total.
 *  - GAP2-WORKS-MASTERS-09 / -05: GET /masters/<type> returns the true total.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { bearerToken, jwtPayload, TENANT_A, ACTOR_A, ACTOR_B, AA_ID, TS_ID, AWARD_ID } from "./fixtures/works-fixtures.js";

const aaStore: Record<string, Record<string, unknown>> = {};
const tsStore: Record<string, Record<string, unknown>> = {};
const awardStore: Record<string, Record<string, unknown>> = {};

vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return {
    ...orig,
    getAa: vi.fn(async (_t: string, id: string) => aaStore[id] ?? null),
    getTs: vi.fn(async (_t: string, id: string) => tsStore[id] ?? null),
    countAaForWork: vi.fn(async () => 0),
    countTsForWork: vi.fn(async () => 0),
    listAa: vi.fn(async () => Array.from({ length: 100 }, (_v, i) => ({ id: `aa-${i}`, status: "draft" }))),
    listTs: vi.fn(async () => Array.from({ length: 100 }, (_v, i) => ({ id: `ts-${i}`, status: "draft" }))),
    countAa: vi.fn(async () => 101),
    countTs: vi.fn(async () => 207),
  };
});

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return {
    ...orig,
    getAwardById: vi.fn(async (_t: string, id: string) => awardStore[id] ?? null),
    getTenderById: vi.fn(async () => null),
    listTenders: vi.fn(async () => []),
    countTenders: vi.fn(async () => 0),
    listQuotations: vi.fn(async () => []),
    finalizedAgreementByWorkIds: vi.fn(async () => new Map()),
  };
});

vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return {
    ...orig,
    listBills: vi.fn(async () => Array.from({ length: 100 }, (_v, i) => ({ id: `bill-${i}`, status: "draft" }))),
    countBills: vi.fn(async () => 133),
  };
});

vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return {
    ...orig,
    listClosures: vi.fn(async () => Array.from({ length: 100 }, (_v, i) => ({ id: `cl-${i}`, workId: `w-${i}` }))),
    countClosures: vi.fn(async () => 155),
  };
});

vi.mock("../src/modules/masters/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/masters/repo.js")>();
  return {
    ...orig,
    listMaster: vi.fn(async () => Array.from({ length: 100 }, (_v, i) => ({ id: `m-${i}`, name: `M${i}`, version: 1 }))),
    countMaster: vi.fn(async () => 142),
  };
});

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
  Cache: class { getOrLoad(_k: string, fn: Function) { return fn(); } invalidate() { return Promise.resolve(); } },
}));
vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn().mockResolvedValue(undefined); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn().mockResolvedValue(true), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
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

function headerFor(actorId: string, roles: string[]) {
  return { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles, actorId))}` };
}

describe("GAP2-WORKS-APPROVALS-01: AA/TS maker-checker (no self-finalize)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    Object.keys(aaStore).forEach((k) => delete aaStore[k]);
    Object.keys(tsStore).forEach((k) => delete tsStore[k]);
  });

  it("AA finalize by the creator → 422 SELF_APPROVAL_FORBIDDEN", async () => {
    aaStore[AA_ID] = { id: AA_ID, status: "draft", createdBy: ACTOR_A };
    const res = await app.inject({
      method: "POST", url: `/v1/works/approvals/aa/${AA_ID}/finalize`,
      headers: headerFor(ACTOR_A, ["dao", "works_admin"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("AA finalize by a DIFFERENT actor → 202", async () => {
    aaStore[AA_ID] = { id: AA_ID, status: "draft", createdBy: ACTOR_A };
    const res = await app.inject({
      method: "POST", url: `/v1/works/approvals/aa/${AA_ID}/finalize`,
      headers: headerFor(ACTOR_B, ["dao", "works_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("TS finalize by the creator → 422 SELF_APPROVAL_FORBIDDEN", async () => {
    tsStore[TS_ID] = { id: TS_ID, status: "draft", createdBy: ACTOR_A };
    const res = await app.inject({
      method: "POST", url: `/v1/works/approvals/ts/${TS_ID}/finalize`,
      headers: headerFor(ACTOR_A, ["dao", "works_admin"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("TS finalize by a DIFFERENT actor → 202", async () => {
    tsStore[TS_ID] = { id: TS_ID, status: "draft", createdBy: ACTOR_A };
    const res = await app.inject({
      method: "POST", url: `/v1/works/approvals/ts/${TS_ID}/finalize`,
      headers: headerFor(ACTOR_B, ["dao", "works_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP2-WORKS-TENDERS-04: award maker-checker (no self-finalize)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { Object.keys(awardStore).forEach((k) => delete awardStore[k]); });

  it("DAO-finalize by the award creator → 422 SELF_APPROVAL_FORBIDDEN", async () => {
    awardStore[AWARD_ID] = { id: AWARD_ID, status: "draft", createdBy: ACTOR_A, daoFinalizedBy: null };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${AWARD_ID}/dao-finalize`,
      headers: headerFor(ACTOR_A, ["dao"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("DAO-finalize by a different dao actor → 202", async () => {
    awardStore[AWARD_ID] = { id: AWARD_ID, status: "draft", createdBy: ACTOR_A, daoFinalizedBy: null };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${AWARD_ID}/dao-finalize`,
      headers: headerFor(ACTOR_B, ["dao"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("DO-finalize by the same actor who DAO-finalized → 422 SELF_APPROVAL_FORBIDDEN", async () => {
    awardStore[AWARD_ID] = { id: AWARD_ID, status: "dao_finalized", createdBy: ACTOR_A, daoFinalizedBy: ACTOR_B };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${AWARD_ID}/do-finalize`,
      headers: headerFor(ACTOR_B, ["do"]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("DO-finalize by a third actor distinct from creator + DAO finalizer → 202", async () => {
    awardStore[AWARD_ID] = { id: AWARD_ID, status: "dao_finalized", createdBy: ACTOR_A, daoFinalizedBy: ACTOR_B };
    const res = await app.inject({
      method: "POST", url: `/v1/works/tenders/award/${AWARD_ID}/do-finalize`,
      headers: headerFor("00000000-aaaa-4000-8000-000000000003", ["do"]),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP2-WORKS-APPROVALS-05 / CLOSURE-06 / MASTERS-09: true register totals", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  const reader = headerFor(ACTOR_A, ["works_viewer"]);

  it("GET /approvals/aa → meta.total is the true count (101), not the page length (100)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/approvals/aa?pageSize=100", headers: reader });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(100);
    expect(res.json().meta.total).toBe(101);
  });

  it("GET /approvals/ts → meta.total is the true count (207), not 100", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/approvals/ts?pageSize=100", headers: reader });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(207);
  });

  it("GET /billing/bills → meta.total is the true count (133), not 100", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/billing/bills?pageSize=100", headers: reader });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(133);
  });

  it("GET /closure → meta.total is the true count (155), not 100", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/closure?pageSize=100", headers: reader });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(155);
  });

  it("GET /masters/authorities → meta.total is the true count (142), not 100", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/authorities?pageSize=100", headers: reader });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(142);
  });
});

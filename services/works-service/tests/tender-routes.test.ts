/**
 * Tender routes — list total (GAP-WORKS-TENDERS-06), tender-by-id reachability
 * (GAP-WORKS-TENDERS-DETAIL-03), award-by-id + finalize role gating and order
 * (GAP-WORKS-TENDERS-DETAIL-02 / DETAIL-08), and pre-tender role gate
 * (GAP-WORKS-TENDERS-NEW-06). Mock-based harness mirroring
 * proposals-list-total.test.ts / route-finalization-guards.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const TENDER_PAGE = Array.from({ length: 100 }, (_v, i) => ({
  id: `00000000-1111-4000-8000-0000000001${String(i).padStart(2, "0")}`,
  workId: null,
  tenderTypeId: null,
  tenderAmountMinor: 0n,
  openingDate: null,
  approvingAuthorityId: null,
  contractorClassId: null,
  remarks: null,
  createdAt: new Date(),
  workNumber: `WRK/${i}`,
}));

const awardStore: Record<string, { id: string; status: string; workId: string; contractorId: string | null; contractorName: string; acceptedAmountMinor: bigint; daoFinalizedAt: Date | null; doFinalizedAt: Date | null }> = {};
const tenderById: Record<string, unknown> = {
  "00000000-1111-4000-8000-000000000250": {
    id: "00000000-1111-4000-8000-000000000250",
    workId: null, tenderTypeId: null, tenderAmountMinor: 0n, openingDate: null,
    approvingAuthorityId: null, contractorClassId: null, remarks: null, createdAt: new Date(), workNumber: "WRK/250",
  },
};

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return {
    ...orig,
    listTenders: vi.fn(async () => TENDER_PAGE),
    countTenders: vi.fn(async () => 250),
    getTenderById: vi.fn(async (_t: string, id: string) => tenderById[id] ?? null),
    getAwardById: vi.fn(async (_t: string, id: string) => awardStore[id] ?? null),
    listQuotations: vi.fn(async () => []),
    tenderOrPreTenderExists: vi.fn(async () => true),
  };
});

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

const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
function authHeader(roles: string[]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("GET /v1/works/tenders — GAP-WORKS-TENDERS-06 true total", () => {
  it("meta.total reflects the full tenant count (250), not the page length (100)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/tenders?pageSize=100", headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(100);
    expect(body.meta.total).toBe(250);
    expect(body.meta.total).not.toBe(body.data.length);
  });
});

describe("GET /v1/works/tenders/:id — GAP-WORKS-TENDERS-DETAIL-03 reachability", () => {
  it("resolves a tender ranked beyond the list cap directly by id (200)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/tenders/00000000-1111-4000-8000-000000000250", headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.workNumber).toBe("WRK/250");
  });

  it("404s a valid-but-unknown tender id", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/tenders/00000000-1111-4000-8000-000000009999", headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("GET /v1/works/tenders/award/:id — GAP-WORKS-TENDERS-DETAIL-02 award read", () => {
  it("returns the award status so the FE can gate DO-finalize", async () => {
    awardStore["00000000-1111-4000-8000-000000000a01"] = {
      id: "00000000-1111-4000-8000-000000000a01", status: "dao_finalized", workId: "w", contractorId: null, contractorName: "ACME", acceptedAmountMinor: 100n, daoFinalizedAt: new Date(), doFinalizedAt: null,
    };
    const res = await app.inject({ method: "GET", url: "/v1/works/tenders/award/00000000-1111-4000-8000-000000000a01", headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("dao_finalized");
  });
});

describe("Finalize role gating + order — GAP-WORKS-TENDERS-DETAIL-02 / DETAIL-08", () => {
  const AWARD = "00000000-1111-4000-8000-000000000b01";

  it("403s DAO-finalize for a user without an authorised role", async () => {
    awardStore[AWARD] = { id: AWARD, status: "draft", workId: "w", contractorId: null, contractorName: "ACME", acceptedAmountMinor: 100n, daoFinalizedAt: null, doFinalizedAt: null };
    const res = await app.inject({ method: "POST", url: `/v1/works/tenders/award/${AWARD}/dao-finalize`, headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(403);
  });

  it("422s DO-finalize while the award is still draft (DAO must go first)", async () => {
    awardStore[AWARD] = { id: AWARD, status: "draft", workId: "w", contractorId: null, contractorName: "ACME", acceptedAmountMinor: 100n, daoFinalizedAt: null, doFinalizedAt: null };
    const res = await app.inject({ method: "POST", url: `/v1/works/tenders/award/${AWARD}/do-finalize`, headers: authHeader(["do"]) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("FINALIZATION_BLOCKED");
  });

  it("202s DAO-finalize for a DAO on a draft award", async () => {
    awardStore[AWARD] = { id: AWARD, status: "draft", workId: "w", contractorId: null, contractorName: "ACME", acceptedAmountMinor: 100n, daoFinalizedAt: null, doFinalizedAt: null };
    const res = await app.inject({ method: "POST", url: `/v1/works/tenders/award/${AWARD}/dao-finalize`, headers: authHeader(["dao"]) });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/works/tenders/pre-tender — GAP-WORKS-TENDERS-NEW-06 gate", () => {
  it("403s a read-only role from creating a pre-tender", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/pre-tender", headers: authHeader(["works_viewer"]),
      payload: { workId: "00000000-1111-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a valid openingDate (GAP-WORKS-TENDERS-NEW-02) for a writer", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/pre-tender", headers: authHeader(["works_operator"]),
      payload: { workId: "00000000-1111-4000-8000-000000000001", openingDate: "2026-11-01T00:00:00Z" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("422/400s a pre-tender with an invalid openingDate", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/pre-tender", headers: authHeader(["works_operator"]),
      payload: { workId: "00000000-1111-4000-8000-000000000001", openingDate: "not-a-date" },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});

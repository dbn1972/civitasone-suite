/**
 * Route finalization guards — approval AA/TS one-time finalize, TS DAO gate,
 * billing MB/bill step sequence, and immutable terminal states (422).
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { bearerToken, jwtPayload, TENANT_A, AA_ID, TS_ID, MB_ID, BILL_ID } from "./fixtures/works-fixtures.js";

const aaStore: Record<string, { id: string; status: string }> = {};
const tsStore: Record<string, { id: string; status: string }> = {};
const proposalStore: Record<string, { id: string; status: string }> = {};
const mbStore: Record<string, { id: string; status: string }> = {};
const billStore: Record<string, { id: string; status: string }> = {};

vi.mock("../src/modules/approval/repo.js", () => ({
  getAa: vi.fn(async (_t: string, id: string) => aaStore[id] ?? null),
  getTs: vi.fn(async (_t: string, id: string) => tsStore[id] ?? null),
  countAaForWork: vi.fn(async () => 0),
  countTsForWork: vi.fn(async () => 0),
  listAa: vi.fn(async () => []),
  listTs: vi.fn(async () => []),
}));

vi.mock("../src/modules/proposal/repo.js", () => ({
  getProposal: vi.fn(async (_t: string, id: string) => proposalStore[id] ?? null),
  countProposals: vi.fn(async () => 0),
  proposalStatusCounts: vi.fn(async () => []),
}));

vi.mock("../src/modules/billing/repo.js", () => ({
  getMb: vi.fn(async (_t: string, id: string) => mbStore[id] ?? null),
  getBill: vi.fn(async (_t: string, id: string) => billStore[id] ?? null),
  listBillsForWork: vi.fn(async () => []),
}));

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

const auth = { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin", "super_admin"]))}` };

describe("Approval finalization guards", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { Object.keys(aaStore).forEach((k) => delete aaStore[k]); Object.keys(tsStore).forEach((k) => delete tsStore[k]); Object.keys(proposalStore).forEach((k) => delete proposalStore[k]); });

  it("AA finalize → 422 when already finalized (immutable)", async () => {
    aaStore[AA_ID] = { id: AA_ID, status: "finalized" };
    const res = await app.inject({ method: "POST", url: `/v1/works/approvals/aa/${AA_ID}/finalize`, headers: auth });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("FINALIZATION_BLOCKED");
  });

  it("TS create → 422 when proposal is still draft (BR-011 DAO gate)", async () => {
    const workId = "00000000-1111-4000-8000-000000000001";
    proposalStore[workId] = { id: workId, status: "draft" };
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/ts", headers: auth,
      payload: {
        workId, tsNumber: "TS/2026/001", tsDate: "2026-01-01T00:00:00Z",
        tsAuthorityId: "00000000-2222-4000-8000-000000000001", tsAmountMinor: "5000000",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DAO_GATE_BLOCKED");
  });

  it("TS create → 202 when proposal is dao_finalized", async () => {
    const workId = "00000000-1111-4000-8000-000000000002";
    proposalStore[workId] = { id: workId, status: "dao_finalized" };
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/ts", headers: auth,
      payload: {
        workId, tsNumber: "TS/2026/002", tsDate: "2026-01-01T00:00:00Z",
        tsAuthorityId: "00000000-2222-4000-8000-000000000001", tsAmountMinor: "5000000",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("TS finalize → 422 when already finalized", async () => {
    tsStore[TS_ID] = { id: TS_ID, status: "finalized" };
    const res = await app.inject({ method: "POST", url: `/v1/works/approvals/ts/${TS_ID}/finalize`, headers: auth });
    expect(res.statusCode).toBe(422);
  });
});

describe("Billing finalization step guards", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { Object.keys(mbStore).forEach((k) => delete mbStore[k]); Object.keys(billStore).forEach((k) => delete billStore[k]); });

  it("MB finalize → 422 when skipping a step (draft → estimator_finalized)", async () => {
    mbStore[MB_ID] = { id: MB_ID, status: "draft" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/billing/mb/${MB_ID}/finalize`, headers: auth,
      payload: { nextStatus: "estimator_finalized" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STEP");
  });

  it("MB finalize → 202 for valid first step (draft → so_finalized)", async () => {
    mbStore[MB_ID] = { id: MB_ID, status: "draft" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/billing/mb/${MB_ID}/finalize`, headers: auth,
      payload: { nextStatus: "so_finalized" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("Bill finalize → 422 when skipping auditor step", async () => {
    billStore[BILL_ID] = { id: BILL_ID, status: "sdo_finalized" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/billing/bills/${BILL_ID}/finalize`, headers: auth,
      payload: { nextStatus: "dao_finalized" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("Bill finalize → 422 when re-finalizing at do_finalized (terminal)", async () => {
    billStore[BILL_ID] = { id: BILL_ID, status: "do_finalized" };
    const res = await app.inject({
      method: "POST", url: `/v1/works/billing/bills/${BILL_ID}/finalize`, headers: auth,
      payload: { nextStatus: "do_finalized" },
    });
    expect(res.statusCode).toBe(422);
  });
});

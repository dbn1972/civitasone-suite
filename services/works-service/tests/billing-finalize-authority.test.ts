/**
 * GAP-WORKS-BILLING-WORKID-03 / -07: bill and MB finalize enforce a per-step
 * authority (the officer the step represents, or an admin) and maker-checker
 * (the creator/issuer may not finalize their own record), at the route.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, ACTOR_A, ACTOR_B, MB_ID, BILL_ID, WORK_ID, AWARD_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getMb = vi.fn();
const getMbByNumber = vi.fn();
const listBills = vi.fn();
const countBills = vi.fn();
const getAwardById = vi.fn();
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, getAwardById };
});
const getBill = vi.fn();

vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return { ...orig, getMb, getMbByNumber, getBill, listBills, countBills };
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
      if (err?.name === "ZodError") return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
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

const roleAuth = (roles: string[], actor = ACTOR_B) => `Bearer ${bearerToken(jwtPayload(TENANT_A, roles, actor))}`;

describe("billing finalize authority + maker-checker", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const finalizeBill = (auth: string, nextStatus: string) =>
    app.inject({ method: "POST", url: `/v1/works/billing/bills/${BILL_ID}/finalize`, headers: { authorization: auth }, payload: { nextStatus } });
  const finalizeMb = (auth: string, nextStatus: string) =>
    app.inject({ method: "POST", url: `/v1/works/billing/mb/${MB_ID}/finalize`, headers: { authorization: auth }, payload: { nextStatus } });

  it("an estimator cannot advance a bill to the DAO step (403)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "auditor_finalized", createdBy: ACTOR_A });
    expect((await finalizeBill(roleAuth(["estimator"]), "dao_finalized")).statusCode).toBe(403);
  });

  it("an auditor-only actor may advance sdo_finalized to auditor_finalized (202)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "sdo_finalized", createdBy: ACTOR_A });
    expect((await finalizeBill(roleAuth(["auditor"]), "auditor_finalized")).statusCode).toBe(202);
  });

  it("an auditor-only actor cannot advance any other bill step (403)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "auditor_finalized", createdBy: ACTOR_A });
    expect((await finalizeBill(roleAuth(["auditor"]), "dao_finalized")).statusCode).toBe(403);
  });

  it("a role holding the blanket gate cannot take a step it does not own: DO attempting so_finalized (403)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "draft", createdBy: ACTOR_A });
    expect((await finalizeBill(roleAuth(["do"]), "so_finalized")).statusCode).toBe(403);
    getMb.mockResolvedValue({ id: MB_ID, status: "draft", issuedBy: ACTOR_A, createdBy: ACTOR_A });
    expect((await finalizeMb(roleAuth(["do"]), "so_finalized")).statusCode).toBe(403);
  });

  it("a DAO may advance auditor_finalized to dao_finalized (202)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "auditor_finalized", createdBy: ACTOR_A });
    expect((await finalizeBill(roleAuth(["dao"]), "dao_finalized")).statusCode).toBe(202);
  });

  it("the bill creator cannot finalize their own bill (422 SELF_APPROVAL_FORBIDDEN)", async () => {
    getBill.mockResolvedValue({ id: BILL_ID, status: "draft", createdBy: ACTOR_A });
    const res = await finalizeBill(roleAuth(["works_admin"], ACTOR_A), "so_finalized");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("the MB issuer cannot finalize their own MB (422)", async () => {
    getMb.mockResolvedValue({ id: MB_ID, status: "draft", issuedBy: ACTOR_A, createdBy: ACTOR_A });
    expect((await finalizeMb(roleAuth(["section_officer"], ACTOR_A), "so_finalized")).statusCode).toBe(422);
  });

  it("an SO may advance a draft MB to so_finalized; an SO cannot do the DO step", async () => {
    getMb.mockResolvedValue({ id: MB_ID, status: "draft", issuedBy: ACTOR_A, createdBy: ACTOR_A });
    expect((await finalizeMb(roleAuth(["section_officer"]), "so_finalized")).statusCode).toBe(202);
    getMb.mockResolvedValue({ id: MB_ID, status: "estimator_finalized", issuedBy: ACTOR_A, createdBy: ACTOR_A });
    expect((await finalizeMb(roleAuth(["section_officer"]), "do_finalized")).statusCode).toBe(403);
  });

  it("issuing an MB with a number already used for the work is 409 DUPLICATE_MB_NUMBER (NEW-MB-03)", async () => {
    getAwardById.mockResolvedValue({ id: AWARD_ID, workId: WORK_ID });
    getMbByNumber.mockResolvedValue({ id: MB_ID });
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: { authorization: roleAuth(["works_admin"]) },
      payload: { workId: WORK_ID, awardId: AWARD_ID, mbNumber: "MB/001" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DUPLICATE_MB_NUMBER");
  });

  it("a fresh MB number is accepted (202)", async () => {
    getAwardById.mockResolvedValue({ id: AWARD_ID, workId: WORK_ID });
    getMbByNumber.mockResolvedValue(null);
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: { authorization: roleAuth(["works_admin"]) },
      payload: { workId: WORK_ID, awardId: AWARD_ID, mbNumber: "MB/002" },
    });
    expect(res.statusCode).toBe(202);
  });

  // GAP-WORKS-BILLING-05: bills register role gate + response envelope.
  it("GET /v1/works/billing/bills is 403 without a billing read role", async () => {
    listBills.mockClear();
    const res = await app.inject({ method: "GET", url: "/v1/works/billing/bills?pageSize=100", headers: { authorization: roleAuth(["citizen"]) } });
    expect(res.statusCode).toBe(403);
    expect(listBills).not.toHaveBeenCalled();
  });

  it("GET /v1/works/billing/bills returns {data, meta.total} with money as strings for a reader", async () => {
    listBills.mockResolvedValue([{ id: "b1", billNumber: "RA-01", billMode: "e_mb", status: "draft", grossAmountMinor: 1000n, netPayableMinor: 900n, deductionsMinor: 100n }]);
    countBills.mockResolvedValue(1);
    const res = await app.inject({ method: "GET", url: "/v1/works/billing/bills?pageSize=100", headers: { authorization: roleAuth(["works_viewer"]) } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ billNumber: "RA-01", grossAmountMinor: "1000", netPayableMinor: "900" });
  });

  // GAP-WORKS-BILLING-NEW-MB-05: MB issue role gate.
  it("POST /v1/works/billing/mb is 403 without a billing write role and does not look anything up", async () => {
    getMbByNumber.mockClear();
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: { authorization: roleAuth(["works_viewer"]) },
      payload: { workId: WORK_ID, awardId: AWARD_ID, mbNumber: "MB/9" },
    });
    expect(res.statusCode).toBe(403);
    expect(getMbByNumber).not.toHaveBeenCalled();
  });

  // GAP-WORKS-BILLING-ACCOUNT-COMPILE-05: POST role gate, validation, envelope.
  it("POST /account-compile is 403 for a billing reader outside the DAO/DO/admin set", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/account-compile", headers: { authorization: roleAuth(["works_viewer"]) },
      payload: { month: 5, year: 2026 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /account-compile rejects an invalid month with 400 for a DAO", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/account-compile", headers: { authorization: roleAuth(["dao"]) },
      payload: { month: 13, year: 2026 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /account-compile accepts a valid body for a DAO with the 202 accepted envelope", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/account-compile", headers: { authorization: roleAuth(["dao"]) },
      payload: { month: 5, year: 2026, submittedTo: "Treasury Officer" },
    });
    expect(res.statusCode).toBe(202);
  });
});

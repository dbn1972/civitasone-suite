/**
 * GAP-WORKS-BILLING-WORKID-04 / BILLS-NEW-01 / NEW-MB-01: the two new
 * list endpoints that let the FE replace paste-a-UUID inputs with real
 * pickers —
 *   GET /v1/works/billing/:workId/mbs    (measurement books for a work)
 *   GET /v1/works/billing/:workId/awards (awards for a work)
 * — plus GAP-WORKS-BILLING-02's workNumber join on the existing per-work
 * bills list. These assert role gating (403 without a read role), tenant
 * scoping (repo called with the caller's tenant), and the response envelope.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, AWARD_ID, MB_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const listMbsForWork = vi.fn();
const listAwardsForWork = vi.fn();
const listBillsForWork = vi.fn();
const listAccountCompilations = vi.fn();

vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return { ...orig, listMbsForWork, listAwardsForWork, listBillsForWork, listAccountCompilations };
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

describe("billing list endpoints — MBs / awards by work (GAP-WORKS-BILLING-WORKID-04 / BILLS-NEW-01)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const reader = () => `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}`;
  const noRole = () => `Bearer ${bearerToken(jwtPayload(TENANT_A, ["citizen"]))}`;

  it("GET /:workId/mbs returns the measurement books for the work, tenant-scoped", async () => {
    listMbsForWork.mockResolvedValue([{ id: MB_ID, mbNumber: "MB/2024-25/001", status: "do_finalized" }]);
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/${WORK_ID}/mbs`, headers: { authorization: reader() } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: MB_ID, mbNumber: "MB/2024-25/001", status: "do_finalized" }] });
    expect(listMbsForWork).toHaveBeenCalledWith(TENANT_A, WORK_ID);
  });

  it("GET /:workId/mbs is 403 for a caller without a works read role", async () => {
    listMbsForWork.mockClear();
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/${WORK_ID}/mbs`, headers: { authorization: noRole() } });
    expect(res.statusCode).toBe(403);
    expect(listMbsForWork).not.toHaveBeenCalled();
  });

  it("GET /:workId/awards returns the awards for the work, tenant-scoped", async () => {
    listAwardsForWork.mockResolvedValue([{ id: AWARD_ID, agreementNumber: "AGR/42", contractorName: "Acme", status: "do_finalized" }]);
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/${WORK_ID}/awards`, headers: { authorization: reader() } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: AWARD_ID, agreementNumber: "AGR/42" });
    expect(listAwardsForWork).toHaveBeenCalledWith(TENANT_A, WORK_ID);
  });

  it("GET /:workId/awards is 403 for a caller without a works read role", async () => {
    listAwardsForWork.mockClear();
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/${WORK_ID}/awards`, headers: { authorization: noRole() } });
    expect(res.statusCode).toBe(403);
    expect(listAwardsForWork).not.toHaveBeenCalled();
  });

  it("GET /:workId/bills surfaces the workNumber join on each row (GAP-WORKS-BILLING-02)", async () => {
    listBillsForWork.mockResolvedValue([
      { id: "b1", workId: WORK_ID, billNumber: "RA-01", billMode: "e_mb", status: "so_finalized", workNumber: "W/2024/0007", grossAmountMinor: 100000n },
    ]);
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/${WORK_ID}/bills`, headers: { authorization: reader() } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ billNumber: "RA-01", workNumber: "W/2024/0007" });
  });

  it("GET /account-compile?month&year lists prior compilations for the DAO/DO roles (ACCOUNT-COMPILE-03)", async () => {
    listAccountCompilations.mockResolvedValue([
      { id: "c1", month: 5, year: 2026, status: "submitted", submittedTo: "Treasury Officer, Bhubaneswar", submittedAt: "2026-05-01", dagRef: null },
    ]);
    const dao = `Bearer ${bearerToken(jwtPayload(TENANT_A, ["dao"]))}`;
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/account-compile?month=5&year=2026`, headers: { authorization: dao } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ month: 5, year: 2026, status: "submitted" });
    expect(listAccountCompilations).toHaveBeenCalledWith(TENANT_A, 5, 2026);
  });

  it("GET /account-compile is 403 for a caller outside the DAO/DO/admin set", async () => {
    listAccountCompilations.mockClear();
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/account-compile?month=5&year=2026`, headers: { authorization: reader() } });
    // works_viewer is a billing READ role but NOT in the account-compile set
    expect(res.statusCode).toBe(403);
    expect(listAccountCompilations).not.toHaveBeenCalled();
  });
});

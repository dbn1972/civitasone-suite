/**
 * D4c #37 routes: the default statutory deduction rates (read/set per division), the computed-deduction preview the
 * maker starts from, the bill's deduction lines for the checker, and the early 422s on a bill whose lines do not add up.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, AWARD_ID, MB_ID, BILL_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getProposal = vi.fn();
vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, getProposal };
});
const getEffectiveDeductionRates = vi.fn();
const listRecoveriesForBill = vi.fn();
const getBill = vi.fn();
vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return { ...orig, getEffectiveDeductionRates, listRecoveriesForBill, getBill };
});
const setDeductionRatesCommand = vi.fn();
vi.mock("../src/modules/billing/commands.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/commands.js")>();
  return { ...orig, setDeductionRatesCommand };
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
// NOTE: @civitasone/schemas/plugin is intentionally NOT mocked -- the real createFastifyErrorHandler runs, so every
// `.json().code` below is read from the FLAT { code, message, correlationId, retryable } body the service really sends.
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

describe("D4c #37 deduction routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const DIV = "00000000-9999-4000-8000-000000000001";
  const as = (...roles: string[]) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles))}` });
  const RATES = { security_deposit: 500, income_tax_tds: 200, gst_tds: 200, labour_cess: 100, retention: 0 };

  beforeEach(() => {
    for (const m of [getProposal, getEffectiveDeductionRates, listRecoveriesForBill, getBill, setDeductionRatesCommand]) m.mockReset();
    getProposal.mockResolvedValue({ id: WORK_ID, executingDivisionId: DIV, status: "dao_finalized" });
    getEffectiveDeductionRates.mockResolvedValue(RATES);
    setDeductionRatesCommand.mockResolvedValue({ id: "x", status: "accepted", correlationId: "c" });
  });

  it("GET /deduction-rates returns the fixed heads with their effective rate for the division, read roles only", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/deduction-rates?divisionId=${DIV}`, headers: as("works_viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.rates).toEqual([
      { head: "security_deposit", rateBps: 500 }, { head: "income_tax_tds", rateBps: 200 }, { head: "gst_tds", rateBps: 200 },
      { head: "labour_cess", rateBps: 100 }, { head: "retention", rateBps: 0 },
    ]);
    expect(getEffectiveDeductionRates).toHaveBeenCalledWith(TENANT_A, DIV);
    expect((await app.inject({ method: "GET", url: "/v1/works/billing/deduction-rates", headers: as("citizen") })).statusCode).toBe(403);
  });

  it("PUT /deduction-rates is 202 for the works admin and 403 for an operator; bad bps is 400/422 and publishes nothing", async () => {
    const payload = { divisionId: DIV, rates: [{ head: "gst_tds", rateBps: 150 }] };
    const ok = await app.inject({ method: "PUT", url: "/v1/works/billing/deduction-rates", headers: as("works_admin"), payload });
    expect(ok.statusCode).toBe(202);
    expect(setDeductionRatesCommand).toHaveBeenCalledTimes(1);
    const denied = await app.inject({ method: "PUT", url: "/v1/works/billing/deduction-rates", headers: as("works_operator"), payload });
    expect(denied.statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/v1/works/billing/deduction-rates", headers: as("works_admin"), payload: { rates: [{ head: "gst_tds", rateBps: 99999 }] } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
    expect(setDeductionRatesCommand).toHaveBeenCalledTimes(1);
  });

  it("GET /deduction-preview computes each head from the gross using the work's division, as exact strings", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/deduction-preview?workId=${WORK_ID}&grossAmountMinor=1000000`, headers: as("works_operator") });
    expect(res.statusCode).toBe(200);
    expect(getEffectiveDeductionRates).toHaveBeenCalledWith(TENANT_A, DIV);
    expect(res.json().data.lines).toEqual([
      { head: "security_deposit", rateBps: 500, amountMinor: "50000" }, { head: "income_tax_tds", rateBps: 200, amountMinor: "20000" },
      { head: "gst_tds", rateBps: 200, amountMinor: "20000" }, { head: "labour_cess", rateBps: 100, amountMinor: "10000" },
      { head: "retention", rateBps: 0, amountMinor: "0" },
    ]);
    expect(res.json().data.totalMinor).toBe("100000");
  });

  it("GET /deduction-preview is 404 for an unknown work", async () => {
    getProposal.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/deduction-preview?workId=${WORK_ID}&grossAmountMinor=1000`, headers: as("works_operator") });
    expect(res.statusCode).toBe(404);
  });

  it("GET /bills/:id/recoveries shows computed vs charged per head for the checker; 404 for an unknown bill; tenant-scoped", async () => {
    getBill.mockResolvedValue({ id: BILL_ID });
    listRecoveriesForBill.mockResolvedValue([{ id: "r1", recoveryType: "gst_tds", amountMinor: 100n, computedAmountMinor: 200n, rateBps: 200, remarks: null }]);
    const res = await app.inject({ method: "GET", url: `/v1/works/billing/bills/${BILL_ID}/recoveries`, headers: as("auditor") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ recoveryType: "gst_tds", amountMinor: "100", computedAmountMinor: "200", rateBps: 200, adjusted: true });
    expect(listRecoveriesForBill).toHaveBeenCalledWith(TENANT_A, BILL_ID);
    getBill.mockResolvedValue(null);
    expect((await app.inject({ method: "GET", url: `/v1/works/billing/bills/${BILL_ID}/recoveries`, headers: as("auditor") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/works/billing/bills/not-a-uuid/recoveries`, headers: as("auditor") })).statusCode).toBe(400);
  });

  const billBody = (extra: Record<string, unknown>) => ({ workId: WORK_ID, awardId: AWARD_ID, mbId: MB_ID, billMode: "e_mb", billNumber: "RA-1", grossAmountMinor: "1000", ...extra });
  it("POST /bills answers 422 when the lines do not add up to deductionsMinor, or exceed the gross, before anything is queued", async () => {
    const mismatch = await app.inject({ method: "POST", url: "/v1/works/billing/bills", headers: as("works_operator"),
      payload: billBody({ deductionsMinor: "5", recoveries: [{ recoveryType: "gst_tds", amountMinor: "20" }] }) });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().code).toBe("DEDUCTIONS_MISMATCH");
    const over = await app.inject({ method: "POST", url: "/v1/works/billing/bills", headers: as("works_operator"),
      payload: billBody({ recoveries: [{ recoveryType: "retention", amountMinor: "1001" }] }) });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe("DEDUCTIONS_EXCEED_GROSS");
  });
});

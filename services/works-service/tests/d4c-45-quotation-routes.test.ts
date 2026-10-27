/**
 * Owner decision D4c #45: the quotation list carries the server-computed signed deviation % against the work's
 * estimate (hidden from viewers, like the bid itself), marks the awarded quotation, and a new read tells the client
 * when the queued award has arrived.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const listQuotations = vi.fn();
const getTenderEstimate = vi.fn();
const getAwardForWork = vi.fn();
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, listQuotations, getTenderEstimate, getAwardForWork };
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

describe("D4c #45 quotation deviation and award result", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const TENDER = "00000000-9999-4000-8000-0000000000b1";
  const C1 = "00000000-aaaa-4000-8000-0000000000c1";
  const as = (role: string) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, [role]))}` });
  const q = (over: Record<string, unknown>) => ({ id: "q", tenantId: TENANT_A, tenderId: TENDER, contractorName: "Acme", contractorId: null, method: "item_rate", quotedAmountMinor: 11200n, quotedPercentage: null, aboveOrBelowOrAtPar: null, version: 1, ...over });
  beforeEach(() => {
    for (const m of [listQuotations, getTenderEstimate, getAwardForWork]) m.mockReset();
    getTenderEstimate.mockResolvedValue({ workId: WORK_ID, estimateMinor: 10000n });
    getAwardForWork.mockResolvedValue(null);
  });

  it("adds a signed deviation % per quotation and the estimate, tenant scoped", async () => {
    listQuotations.mockResolvedValue([
      q({ id: "a", quotedAmountMinor: 11200n }),
      q({ id: "b", quotedAmountMinor: 9675n }),
      q({ id: "c", method: "percentage_rate", quotedAmountMinor: null, quotedPercentage: "4", aboveOrBelowOrAtPar: "below" }),
    ]);
    const res = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_operator") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: { deviationPercent: string | null }) => r.deviationPercent)).toEqual(["12.00", "-3.25", "-4.00"]);
    expect(res.json().meta.estimateMinor).toBe("10000");
    expect(getTenderEstimate).toHaveBeenCalledWith(TENANT_A, TENDER);
  });

  it("deviation is null when the work has no usable estimate", async () => {
    getTenderEstimate.mockResolvedValue({ workId: WORK_ID, estimateMinor: null });
    listQuotations.mockResolvedValue([q({})]);
    const res = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_operator") });
    expect(res.json().data[0].deviationPercent).toBeNull();
    expect(res.json().meta.estimateMinor).toBeNull();
  });

  it("a viewer gets no deviation (it would reveal the bid), like the redacted amount", async () => {
    listQuotations.mockResolvedValue([q({})]);
    const res = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_viewer") });
    expect(res.json().data[0]).toMatchObject({ contractorName: "Bidder (confidential)", quotedAmountMinor: null, deviationPercent: null });
  });

  it("marks the quotation the award went to (by contractor id, else by name) and leaves the rest null, not missing", async () => {
    getAwardForWork.mockResolvedValue({ id: "award-1", contractorId: C1, contractorName: "Acme", status: "draft" });
    listQuotations.mockResolvedValue([q({ id: "a", contractorId: C1 }), q({ id: "b", contractorName: "Other", contractorId: null })]);
    const res = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_operator") });
    expect(res.json().data.map((r: { awardId: string | null }) => r.awardId)).toEqual(["award-1", null]);
    getAwardForWork.mockResolvedValue({ id: "award-2", contractorId: null, contractorName: " acme ", status: "draft" });
    const byName = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_operator") });
    expect(byName.json().data[0].awardId).toBe("award-2");
  });

  it("no award yet: every quotation has awardId null", async () => {
    listQuotations.mockResolvedValue([q({})]);
    const res = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/quotations`, headers: as("works_operator") });
    expect(res.json().data[0].awardId).toBeNull();
  });

  it("GET /:tenderId/award answers {data:null} while the queued award has not arrived, then the award once it has", async () => {
    const none = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/award`, headers: as("works_viewer") });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ data: null });
    getAwardForWork.mockResolvedValue({ id: "award-1", contractorId: C1, contractorName: "Acme", status: "draft", acceptedAmountMinor: 11200n, agreementNumber: "AGR/1" });
    const got = await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/award`, headers: as("works_viewer") });
    expect(got.json().data).toMatchObject({ id: "award-1", status: "draft", acceptedAmountMinor: "11200", agreementNumber: "AGR/1" });
    expect(getAwardForWork).toHaveBeenCalledWith(TENANT_A, WORK_ID);
  });

  it("GET /:tenderId/award is 404 for an unknown tender and 403 without a works read role", async () => {
    getTenderEstimate.mockResolvedValue(null);
    expect((await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/award`, headers: as("works_viewer") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/works/tenders/${TENDER}/award`, headers: as("citizen") })).statusCode).toBe(403);
  });
});

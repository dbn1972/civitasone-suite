/**
 * GAP-WORKS-BOQ-01/02/04, GAP-WORKS-BOQ-WORKID-01, GAP-WORKS-BOQ-NEW-01.
 *
 * Backend behaviour this pass adds / corrects:
 *  - GET /v1/works/boq returns meta.total + meta.totalAmountMinor for the FULL
 *    set (not just the fetched page), and each row carries workNumber + srItemId.
 *  - GET /v1/works/boq/:workId/recapitulation returns a per-component breakdown
 *    (component, basis, rate %, paise amount) whose amounts sum to grandTotal.
 *  - GET /v1/works/masters/sr-items/search enforces the BoQ reader roles and
 *    returns canonical SR code/unit/rate for the Add-item picker.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";
import { recapitulationBreakdown } from "../src/modules/boq/domain.js";

const listAllBoqItems = vi.fn();
const boqIndexSummary = vi.fn();
const getRecapitulation = vi.fn();
const searchSrItems = vi.fn();

vi.mock("../src/modules/boq/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/boq/repo.js")>();
  return { ...orig, listAllBoqItems, boqIndexSummary, getRecapitulation };
});

vi.mock("../src/modules/masters/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/masters/repo.js")>();
  return { ...orig, searchSrItems };
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
      if (err?.name === "ZodError" || err?.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
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

const SR_ITEM_ID = "00000000-9999-4000-8000-000000000001";

describe("works BoQ index / recap / SR search", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const auth = (roles: string[]) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles))}` });

  it("GET /v1/works/boq returns the FULL-set total + amount (not the page length) and workNumber/srItemId per row", async () => {
    listAllBoqItems.mockResolvedValue([
      { id: "b1", workId: WORK_ID, workNumber: "WRK-2026-0007", srItemId: SR_ITEM_ID, itemCode: "SR-1", unit: "cum", rate: 12500n, quantity: "2", amountMinor: 25000n, scopeId: null },
    ]);
    // 150 lines tenant-wide, only one on this page — the point of GAP-WORKS-BOQ-02.
    boqIndexSummary.mockResolvedValue({ total: 150, totalAmountMinor: "9900000" });

    const res = await app.inject({ method: "GET", url: "/v1/works/boq?pageSize=100", headers: auth(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(150);
    expect(body.meta.totalAmountMinor).toBe("9900000");
    expect(body.data[0].workNumber).toBe("WRK-2026-0007");
    expect(body.data[0].srItemId).toBe(SR_ITEM_ID);
  });

  it("GET /v1/works/boq/:workId/recapitulation returns a per-component breakdown that sums to grandTotal", async () => {
    getRecapitulation.mockResolvedValue({
      id: "r1", tenantId: TENANT_A, workId: WORK_ID,
      workAmount: 10000000n, // ₹1,00,000.00
      contingencyPercent: "3", turnoverTaxPercent: "0", workChargePercent: "1",
      qualityControlPercent: "0.5", centagePercent: "10", otherCharges: 50000n,
      grandTotal: 11500000n, version: 1,
    });
    const res = await app.inject({ method: "GET", url: `/v1/works/boq/${WORK_ID}/recapitulation`, headers: auth(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(Array.isArray(d.breakdown)).toBe(true);
    // Work Amount + Contingency + ... + Other Charges
    const sum = d.breakdown.reduce((acc: bigint, l: { amountMinor: string }) => acc + BigInt(l.amountMinor), 0n);
    expect(sum.toString()).toBe(d.computedGrandTotal);
    // every % line names its basis; no % sits in the amount column unlabelled
    const contingency = d.breakdown.find((l: { key: string }) => l.key === "contingency");
    expect(contingency.basis).toBe("work_amount");
    expect(contingency.ratePercent).toBe(3);
    expect(contingency.amountMinor).toBe("300000"); // 3% of ₹1,00,000 = ₹3,000
  });

  it("GET /v1/works/masters/sr-items/search is forbidden without a reader role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/sr-items/search?q=pcc", headers: auth(["unrelated_role"]) });
    expect(res.statusCode).toBe(403);
    expect(searchSrItems).not.toHaveBeenCalled();
  });

  it("GET /v1/works/masters/sr-items/search returns canonical SR rows for a reader", async () => {
    searchSrItems.mockResolvedValue([
      { id: SR_ITEM_ID, itemCode: "PCC-1-4-8", description: "PCC 1:4:8", unit: "cum", rate: 450000n, zone: "I", srYear: "2026" },
    ]);
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/sr-items/search?q=pcc", headers: auth(["estimator"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].itemCode).toBe("PCC-1-4-8");
    expect(searchSrItems).toHaveBeenCalledWith(TENANT_A, "pcc", 20);
  });
});

describe("recapitulationBreakdown (pure)", () => {
  it("each % line is that percentage of the work amount and the lines sum to the grand total", () => {
    const workAmount = 10000000n; // ₹1,00,000.00
    const { lines, grandTotal } = recapitulationBreakdown(workAmount, {
      contingencyPercent: 3, turnoverTaxPercent: 0, workChargePercent: 1,
      qualityControlPercent: 0.5, centagePercent: 10, otherCharges: 50000n,
    });
    const contingency = lines.find((l) => l.key === "contingency")!;
    expect(contingency.amountMinor).toBe(300000n);
    const centage = lines.find((l) => l.key === "centage")!;
    expect(centage.amountMinor).toBe(1000000n); // 10%
    const sum = lines.reduce((a, l) => a + l.amountMinor, 0n);
    expect(sum).toBe(grandTotal);
    // matches the legacy additive formula
    expect(grandTotal).toBe(10000000n + 300000n + 0n + 100000n + 50000n + 1000000n + 50000n);
  });
});

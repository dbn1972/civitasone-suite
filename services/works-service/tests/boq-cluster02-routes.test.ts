/**
 * W2 works rescan, cluster 02 -- BoQ author routes, against the REAL error handler (flat envelope).
 *
 *  GAP-WORKS-BOQ-NEW-04   a duplicate line is a synchronous 409 DUPLICATE_BOQ_LINE (was: 202, then silently dropped by the consumer)
 *  GAP-WORKS-BOQ-NEW-05   BR-015 freeze also applies when ADDING a line; a zero/negative rate or quantity is a 400;
 *                         a role without BoQ author rights gets 403 on POST
 *  GAP-WORKS-BOQ-WORKID-05 a recapitulation needs BoQ lines (work amount is read from them, never from the client);
 *                         a work has ONE recapitulation: a second request is a 409 RECAP_EXISTS, not a second row
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const publishMock = vi.fn().mockResolvedValue(undefined);
const hasFinalizedTsForWork = vi.fn();
const hasTenderForWork = vi.fn();
const hasPreTenderForWork = vi.fn();
const getProposal = vi.fn();
const listBoqLineRefs = vi.fn();
const boqWorkTotals = vi.fn();
const getRecapitulation = vi.fn();

vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return { ...orig, hasFinalizedTsForWork };
});
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, hasTenderForWork, hasPreTenderForWork };
});
vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, getProposal };
});
vi.mock("../src/modules/boq/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/boq/repo.js")>();
  return { ...orig, listBoqLineRefs, boqWorkTotals, getRecapitulation };
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
  createQueue: () => ({ publish: publishMock, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = publishMock; subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn(), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));
// @civitasone/schemas/plugin is NOT mocked: the real flat error envelope is what the web parses.
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

const auth = (roles: string[]) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles))}` });
const validBody = { workId: WORK_ID, itemDescription: "PCC 1:4:8", itemCode: "SR-1", unit: "cum", rate: "450000", quantity: "10.5" };

describe("BoQ author routes (cluster 02)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    publishMock.mockClear();
    hasFinalizedTsForWork.mockReset().mockResolvedValue(true);
    hasTenderForWork.mockReset().mockResolvedValue(false);
    hasPreTenderForWork.mockReset().mockResolvedValue(false);
    getProposal.mockReset().mockImplementation(async (_t: string, id: string) => ({ id, status: "dao_finalized" }));
    listBoqLineRefs.mockReset().mockResolvedValue([]);
    boqWorkTotals.mockReset().mockResolvedValue({ lines: 2, totalMinor: 900000n });
    getRecapitulation.mockReset().mockResolvedValue(null);
  });

  const post = (roles: string[], payload: unknown, url = "/v1/works/boq") =>
    app.inject({ method: "POST", url, headers: auth(roles), payload: payload as object });

  describe("POST /v1/works/boq", () => {
    it("401 without a token and 403 for a role without BoQ author rights, with nothing looked up or published", async () => {
      expect((await app.inject({ method: "POST", url: "/v1/works/boq", payload: validBody })).statusCode).toBe(401);
      const res = await post(["works_viewer"], validBody);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
      expect(hasFinalizedTsForWork).not.toHaveBeenCalled();
      expect(listBoqLineRefs).not.toHaveBeenCalled();
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("202 for a valid line, publishing the rate as paise and the quantity normalised", async () => {
      const res = await post(["estimator"], validBody);
      expect(res.statusCode).toBe(202);
      const cmd = publishMock.mock.calls.find((c) => String(c[0]).includes("boq.add_item"));
      expect(cmd?.[1]?.payload).toMatchObject({ workId: WORK_ID, rate: "450000", quantity: 10.5 });
    });

    it("400 with a field error when the rate is zero or negative -- never a zero/negative amountMinor", async () => {
      for (const rate of ["0", "-100", 0, -5]) {
        const res = await post(["estimator"], { ...validBody, rate });
        expect(res.statusCode).toBe(400);
        expect(res.json().fieldErrors.some((f: { field: string }) => f.field === "rate")).toBe(true);
      }
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("400 when the quantity is zero or negative", async () => {
      for (const quantity of ["0", "-3", 0, -1]) {
        expect((await post(["estimator"], { ...validBody, quantity })).statusCode).toBe(400);
      }
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("422 TS_REQUIRED without a finalized technical sanction", async () => {
      hasFinalizedTsForWork.mockResolvedValue(false);
      const res = await post(["estimator"], validBody);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("TS_REQUIRED");
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("409 BOQ_FROZEN once a tender OR a pre-tender exists for the work (BR-015 applies to adding a line)", async () => {
      hasTenderForWork.mockResolvedValue(true);
      let res = await post(["estimator"], validBody);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("BOQ_FROZEN");
      hasTenderForWork.mockResolvedValue(false);
      hasPreTenderForWork.mockResolvedValue(true);
      res = await post(["estimator"], validBody);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("BOQ_FROZEN");
      expect(listBoqLineRefs).not.toHaveBeenCalled();
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("409 DUPLICATE_BOQ_LINE for the same item code (trimmed, case-insensitive), returned before the 202", async () => {
      listBoqLineRefs.mockResolvedValue([{ workId: WORK_ID, itemCode: "sr-1", itemDescription: "Something else entirely" }]);
      const res = await post(["estimator"], { ...validBody, itemCode: " SR-1 " });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("DUPLICATE_BOQ_LINE");
      expect(listBoqLineRefs).toHaveBeenCalledWith(TENANT_A, WORK_ID);
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("409 DUPLICATE_BOQ_LINE by description when the new line has no item code", async () => {
      listBoqLineRefs.mockResolvedValue([{ workId: WORK_ID, itemCode: null, itemDescription: "pcc 1:4:8" }]);
      const { itemCode: _unused, ...noCode } = validBody;
      const res = await post(["estimator"], { ...noCode, itemDescription: "PCC 1:4:8" });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("DUPLICATE_BOQ_LINE");
    });

    it("a different item code on the same work is accepted", async () => {
      listBoqLineRefs.mockResolvedValue([{ workId: WORK_ID, itemCode: "SR-2", itemDescription: "PCC 1:4:8" }]);
      expect((await post(["estimator"], validBody)).statusCode).toBe(202);
    });
  });

  describe("PATCH /v1/works/boq/:id (same amount rules as add)", () => {
    const ID = "00000000-4444-4000-8000-000000000001";
    it("400 for a zero/negative rate or quantity", async () => {
      for (const payload of [{ rate: "0" }, { rate: "-1" }, { quantity: 0 }, { quantity: -2 }]) {
        const res = await app.inject({ method: "PATCH", url: `/v1/works/boq/${ID}`, headers: auth(["estimator"]), payload });
        expect(res.statusCode).toBe(400);
      }
      expect(publishMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /v1/works/boq/recapitulate", () => {
    const body = { workId: WORK_ID, contingencyPercent: 3, turnoverTaxPercent: 1, workChargePercent: 2, qualityControlPercent: 1, centagePercent: 12.5 };

    it("404 for an unknown work", async () => {
      getProposal.mockResolvedValueOnce(null as never);
      const res = await post(["estimator"], body, "/v1/works/boq/recapitulate");
      expect(res.statusCode).toBe(404);
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("422 BOQ_EMPTY for a work with no BoQ lines (nothing to recapitulate)", async () => {
      boqWorkTotals.mockResolvedValue({ lines: 0, totalMinor: 0n });
      const res = await post(["estimator"], body, "/v1/works/boq/recapitulate");
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("BOQ_EMPTY");
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("409 RECAP_EXISTS when the work already has a recapitulation: refused before the 202, nothing published", async () => {
      getRecapitulation.mockResolvedValue({ id: "00000000-7777-4000-8000-000000000001", workId: WORK_ID, grandTotal: 348555n });
      const res = await post(["estimator"], body, "/v1/works/boq/recapitulate");
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("RECAP_EXISTS");
      expect(res.json().error).toBeUndefined();
      expect(getRecapitulation).toHaveBeenCalledWith(TENANT_A, WORK_ID);
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("a malformed work id is a 400 with the flat code, before any lookup", async () => {
      const res = await post(["estimator"], { ...body, workId: "not-a-uuid" }, "/v1/works/boq/recapitulate");
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(getRecapitulation).not.toHaveBeenCalled();
      expect(publishMock).not.toHaveBeenCalled();
    });

    it("202 for a work with lines, and a client-supplied workAmount never reaches the command", async () => {
      const res = await post(["estimator"], { ...body, workAmount: "999999999999" }, "/v1/works/boq/recapitulate");
      expect(res.statusCode).toBe(202);
      const cmd = publishMock.mock.calls.find((c) => String(c[0]).includes("boq.recapitulate"));
      expect(cmd?.[1]?.payload).toMatchObject({ workId: WORK_ID, centagePercent: 12.5 });
      expect(cmd?.[1]?.payload).not.toHaveProperty("workAmount");
    });

    it("403 for a read-only role", async () => {
      expect((await post(["works_viewer"], body, "/v1/works/boq/recapitulate")).statusCode).toBe(403);
    });
  });
});

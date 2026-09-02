/**
 * Claims module (LTC + CEA) route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all claim endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const CLAIM = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo mocks
  insertLtc: vi.fn(),
  findLtc: vi.fn(),
  listLtcByEmployee: vi.fn(),
  updateLtc: vi.fn(),
  insertCea: vi.fn(),
  findCea: vi.fn(),
  listCeaByEmployee: vi.fn(),
  updateCea: vi.fn(),
  ceaCommittedForChild: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  // The F3 consumer runs inside db.transaction(...) and its first call is
  // markProcessed(tx, msg.messageId), which needs
  // insert().values().onConflictDoNothing().returning(). The bare mockTx insert
  // has no such chain, so the transaction gets its own stub; the route path
  // (scopedRead) keeps using mockTx unchanged.
  const stubTx = {
    ...mockTx,
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        // markProcessed() ends at .onConflictDoNothing().returning(), while the
        // consumer's own inserts are awaited either directly on .values(...) or
        // on .onConflictDoNothing(). Both of those await points are thenable and
        // record via H.insert; .returning() is not, so the inbox row never shows
        // up as a spurious H.insert call.
        const settle = (resolve: (x: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(H.insert(v)).then(resolve, reject);
        return {
          onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }], then: settle }),
          then: settle,
        };
      },
    }),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(stubTx as unknown as typeof mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", async () => {
  // A real MemoryQueue, not a no-op publish stub: these routes answer 200/201
  // as soon as the write is QUEUED, so with a stub queue a consumer that throws
  // is indistinguishable from a consumer that works. See drainF3() below.
  const { MemoryQueue } = await import("@civitasone/queue");
  return {
    cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
    queue: new MemoryQueue(),
  };
});

vi.mock("../src/modules/claims/repo.js", () => ({
  insertLtc: (...a: unknown[]) => H.insertLtc(...a),
  findLtc: (...a: unknown[]) => H.findLtc(...a),
  listLtcByEmployee: (...a: unknown[]) => H.listLtcByEmployee(...a),
  updateLtc: (...a: unknown[]) => H.updateLtc(...a),
  insertCea: (...a: unknown[]) => H.insertCea(...a),
  findCea: (...a: unknown[]) => H.findCea(...a),
  listCeaByEmployee: (...a: unknown[]) => H.listCeaByEmployee(...a),
  updateCea: (...a: unknown[]) => H.updateCea(...a),
  ceaCommittedForChild: (...a: unknown[]) => H.ceaCommittedForChild(...a),
}));

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_claims_Consumers } from "../src/modules/claims/f3-consumer.js";

// Only worker.ts wires the F3 consumers in production, so tests must subscribe
// it themselves. Registered once for the whole file (MemoryQueue accumulates
// handlers, so re-registering per test would double every write).
registerF3_claims_Consumers(queue);

/** Await the async F3 write published by the route just injected. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const employee = () => ({
  id: EMP, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  departmentId: "dddddddd-0001-4000-8000-000000000001",
  managerId: "eeeeeeee-0001-4000-8000-000000000001",
  pensionScheme: "GPF", status: "confirmed",
});

const ltcClaim = (over = {}): Record<string, unknown> => ({
  id: CLAIM, tenantId: TENANT, employeeId: EMP, blockYear: "2024-2028",
  ltcType: "hometown", journeyFrom: "Delhi", journeyTo: "Jaipur",
  travelDate: "2026-05-01", familyMembers: 2,
  claimedFareMinor: 50000n, entitlementMinor: 40000n,
  status: "submitted", version: 1,
  ...over,
});

const ceaClaim = (over = {}): Record<string, unknown> => ({
  id: CLAIM, tenantId: TENANT, employeeId: EMP, academicYear: "2025-26",
  childName: "Arjun", childRef: "child-1", claimKind: "tuition",
  claimedAmountMinor: 30000n, annualCapMinor: 50000n,
  status: "submitted", version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([employee()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
  H.insertLtc.mockResolvedValue(undefined);
  H.insertCea.mockResolvedValue(undefined);
  H.updateLtc.mockResolvedValue(undefined);
  H.updateCea.mockResolvedValue(undefined);
  H.listLtcByEmployee.mockResolvedValue([]);
  H.listCeaByEmployee.mockResolvedValue([]);
  H.ceaCommittedForChild.mockResolvedValue(0n);
});
afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// =================== LTC Claims ===================
describe("LTC claims", () => {
  describe("POST /v1/hrms/employees/:id/ltc-claims", () => {
    const payload = {
      blockYear: "2024-2028", ltcType: "hometown",
      journeyFrom: "Delhi", journeyTo: "Jaipur", travelDate: "2026-05-01",
      familyMembers: 2, claimedFareMinor: 50000, entitlementMinor: 40000,
    };

    it("submits an LTC claim (202 accepted)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe("accepted");
      expect(r.json().employeeId).toBe(EMP);
      await app.close();
    });

    it("employees can submit their own claims (202 accepted)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(USER, ["employee"]), payload });
      expect(r.statusCode).toBe(202);
      await app.close();
    });

    it("returns 400 on invalid payload", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(), payload: { blockYear: "x" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("VALIDATION_FAILED");
      await app.close();
    });

    it("returns 400 on invalid UUID param", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/not-a-uuid/ltc-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(400);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, payload });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(USER, ["audit_officer"]), payload });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when employee not found", async () => {
      H.selectFrom.mockResolvedValue([]);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });
  });

  describe("GET /v1/hrms/employees/:id/ltc-claims", () => {
    it("lists LTC claims (200)", async () => {
      H.listLtcByEmployee.mockResolvedValue([ltcClaim()]);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().data).toHaveLength(1);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/ltc-claims` });
      expect(r.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("GET /v1/hrms/ltc-claims/:claimId", () => {
    it("reads a single LTC claim (200)", async () => {
      H.findLtc.mockResolvedValue(ltcClaim());
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/ltc-claims/${CLAIM}`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe(CLAIM);
      await app.close();
    });

    it("returns 404 when claim not found", async () => {
      H.findLtc.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/ltc-claims/${CLAIM}`, headers: auth() });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });
  });

  describe("POST /v1/hrms/ltc-claims/:claimId/approve", () => {
    it("approves a submitted claim with fare capped at entitlement (200)", async () => {
      H.findLtc.mockResolvedValue(ltcClaim());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("approved");
      // claimed 50000 > entitlement 40000 → capped
      expect(r.json().approvedFareMinor).toBe("40000");
      expect(r.json().cappedToEntitlement).toBe(true);
      // The 200 above only means "queued". Regression guard for the F3 bug:
      // updateLtc must actually be reached, against the :claimId path param and
      // the claim's current version, with the entitlement-capped fare.
      await drainF3();
      expect(H.updateLtc).toHaveBeenCalledTimes(1);
      expect(H.updateLtc.mock.calls[0]?.[2]).toBe(CLAIM);
      expect(H.updateLtc.mock.calls[0]?.[3]).toMatchObject({ status: "approved", approvedFareMinor: 40000n });
      expect(H.updateLtc.mock.calls[0]?.[4]).toBe(1);
      await app.close();
    });

    it("when claimed <= entitlement, approvedFare = claimedFare (200)", async () => {
      H.findLtc.mockResolvedValue(ltcClaim({ claimedFareMinor: 30000n, entitlementMinor: 40000n }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().approvedFareMinor).toBe("30000");
      expect(r.json().cappedToEntitlement).toBe(false);
      await drainF3();
      expect(H.updateLtc).toHaveBeenCalledTimes(1);
      expect(H.updateLtc.mock.calls[0]?.[3]).toMatchObject({ status: "approved", approvedFareMinor: 30000n });
      await app.close();
    });

    it("returns 403 for employee role (not hr)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(USER, ["employee"]), payload: {} });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when claim not found", async () => {
      H.findLtc.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(404);
      await app.close();
    });

    it("returns 409 when claim is not in submitted state", async () => {
      H.findLtc.mockResolvedValue(ltcClaim({ status: "approved" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("WRONG_STATE");
      await app.close();
    });
  });

  describe("POST /v1/hrms/ltc-claims/:claimId/reject", () => {
    it("rejects a submitted claim (200)", async () => {
      H.findLtc.mockResolvedValue(ltcClaim());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/reject`, headers: auth(), payload: { approverRemarks: "docs missing" } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("rejected");
      await drainF3();
      expect(H.updateLtc).toHaveBeenCalledTimes(1);
      expect(H.updateLtc.mock.calls[0]?.[2]).toBe(CLAIM);
      expect(H.updateLtc.mock.calls[0]?.[3]).toMatchObject({ status: "rejected", approverRemarks: "docs missing" });
      await app.close();
    });

    it("returns 409 if claim already approved", async () => {
      H.findLtc.mockResolvedValue(ltcClaim({ status: "approved" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/reject`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("WRONG_STATE");
      await app.close();
    });
  });
});

// =================== CEA Claims ===================
describe("CEA claims", () => {
  describe("POST /v1/hrms/employees/:id/cea-claims", () => {
    const payload = {
      academicYear: "2025-26", childName: "Arjun", childRef: "child-1",
      claimKind: "tuition", claimedAmountMinor: 30000, annualCapMinor: 50000,
    };

    it("submits a CEA claim (202 accepted)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe("accepted");
      expect(r.json().remainingCapMinor).toBe("20000");
      await app.close();
    });

    it("returns 400 on invalid payload", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(), payload: { academicYear: "x" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("VALIDATION_FAILED");
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, payload });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(USER, ["audit_officer"]), payload });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when employee not found", async () => {
      H.selectFrom.mockResolvedValue([]);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(404);
      await app.close();
    });

    it("returns 409 when annual cap exceeded", async () => {
      H.ceaCommittedForChild.mockResolvedValue(45000n);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("CEA_CAP_EXCEEDED");
      await app.close();
    });
  });

  describe("GET /v1/hrms/employees/:id/cea-claims", () => {
    it("lists CEA claims (200)", async () => {
      H.listCeaByEmployee.mockResolvedValue([ceaClaim()]);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().data).toHaveLength(1);
      await app.close();
    });
  });

  describe("GET /v1/hrms/cea-claims/:claimId", () => {
    it("reads a single CEA claim (200)", async () => {
      H.findCea.mockResolvedValue(ceaClaim());
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/cea-claims/${CLAIM}`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe(CLAIM);
      await app.close();
    });

    it("returns 404 when claim not found", async () => {
      H.findCea.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/cea-claims/${CLAIM}`, headers: auth() });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });
  });

  describe("POST /v1/hrms/cea-claims/:claimId/approve", () => {
    it("approves a submitted CEA claim capped at remaining (200)", async () => {
      H.findCea.mockResolvedValue(ceaClaim());
      H.ceaCommittedForChild.mockResolvedValue(30000n);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("approved");
      // remaining = 50000 - 30000 = 20000, claimed = 30000 → capped to 20000
      expect(r.json().approvedAmountMinor).toBe("20000");
      expect(r.json().cappedToAnnualCap).toBe(true);
      // Regression guard for the F3 bug: the consumer must recompute the
      // per-child remaining cap and reach updateCea, not throw on undefined locals.
      await drainF3();
      expect(H.updateCea).toHaveBeenCalledTimes(1);
      expect(H.updateCea.mock.calls[0]?.[2]).toBe(CLAIM);
      expect(H.updateCea.mock.calls[0]?.[3]).toMatchObject({ status: "approved", approvedAmountMinor: 20000n });
      expect(H.updateCea.mock.calls[0]?.[4]).toBe(1);
      await app.close();
    });

    it("when claimed <= remaining, approvedAmount = claimedAmount (200)", async () => {
      H.findCea.mockResolvedValue(ceaClaim({ claimedAmountMinor: 10000n }));
      H.ceaCommittedForChild.mockResolvedValue(0n);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().approvedAmountMinor).toBe("10000");
      expect(r.json().cappedToAnnualCap).toBe(false);
      await drainF3();
      expect(H.updateCea).toHaveBeenCalledTimes(1);
      expect(H.updateCea.mock.calls[0]?.[3]).toMatchObject({ status: "approved", approvedAmountMinor: 10000n });
      await app.close();
    });

    it("returns 403 for employee role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/approve`, headers: auth(USER, ["employee"]), payload: {} });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when claim not found", async () => {
      H.findCea.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(404);
      await app.close();
    });

    it("returns 409 when claim not in submitted state", async () => {
      H.findCea.mockResolvedValue(ceaClaim({ status: "rejected" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("WRONG_STATE");
      await app.close();
    });
  });

  describe("POST /v1/hrms/cea-claims/:claimId/reject", () => {
    it("rejects a submitted CEA claim (200)", async () => {
      H.findCea.mockResolvedValue(ceaClaim());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/reject`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("rejected");
      await drainF3();
      expect(H.updateCea).toHaveBeenCalledTimes(1);
      expect(H.updateCea.mock.calls[0]?.[2]).toBe(CLAIM);
      expect(H.updateCea.mock.calls[0]?.[3]).toMatchObject({ status: "rejected" });
      await app.close();
    });

    it("returns 409 if claim already approved", async () => {
      H.findCea.mockResolvedValue(ceaClaim({ status: "approved" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/cea-claims/${CLAIM}/reject`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("WRONG_STATE");
      await app.close();
    });
  });
});

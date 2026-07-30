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
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

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

    it("submits an LTC claim (201)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(201);
      expect(r.json().status).toBe("submitted");
      expect(r.json().employeeId).toBe(EMP);
      await app.close();
    });

    it("employees can submit their own claims (201)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/ltc-claims`, headers: auth(USER, ["employee"]), payload });
      expect(r.statusCode).toBe(201);
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
      await app.close();
    });

    it("when claimed <= entitlement, approvedFare = claimedFare (200)", async () => {
      H.findLtc.mockResolvedValue(ltcClaim({ claimedFareMinor: 30000n, entitlementMinor: 40000n }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/ltc-claims/${CLAIM}/approve`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().approvedFareMinor).toBe("30000");
      expect(r.json().cappedToEntitlement).toBe(false);
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

    it("submits a CEA claim (201)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/cea-claims`, headers: auth(), payload });
      expect(r.statusCode).toBe(201);
      expect(r.json().status).toBe("submitted");
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

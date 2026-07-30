/**
 * Deputation lifecycle route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all deputation endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const DEP = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo mocks
  insertDeputation: vi.fn(),
  findById: vi.fn(),
  findActiveByEmployee: vi.fn(),
  listByEmployee: vi.fn(),
  closeDeputation: vi.fn(),
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

vi.mock("../src/modules/deputation/repo.js", () => ({
  insertDeputation: (...a: unknown[]) => H.insertDeputation(...a),
  findById: (...a: unknown[]) => H.findById(...a),
  findActiveByEmployee: (...a: unknown[]) => H.findActiveByEmployee(...a),
  listByEmployee: (...a: unknown[]) => H.listByEmployee(...a),
  closeDeputation: (...a: unknown[]) => H.closeDeputation(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const employee = (over = {}) => ({
  id: EMP, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  departmentId: "dddddddd-0001-4000-8000-000000000001",
  managerId: "eeeeeeee-0001-4000-8000-000000000001",
  pensionScheme: "GPF", status: "confirmed",
  ...over,
});

const deputation = (over = {}): Record<string, unknown> => ({
  id: DEP, tenantId: TENANT, employeeId: EMP,
  parentCadre: "Section Officer", parentDepartmentId: "dddddddd-0001-4000-8000-000000000001",
  parentManagerId: "eeeeeeee-0001-4000-8000-000000000001",
  borrowingDepartment: "Finance Ministry",
  borrowingDepartmentId: "dddddddd-0002-4000-8000-000000000002",
  borrowingManagerId: "eeeeeeee-0002-4000-8000-000000000002",
  deputationAllowanceMinor: 500000n,
  tenureFrom: "2025-01-01", tenureTo: "2027-12-31",
  status: "active", version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([employee()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
  H.insertDeputation.mockResolvedValue(undefined);
  H.findById.mockResolvedValue(null);
  H.findActiveByEmployee.mockResolvedValue(null);
  H.listByEmployee.mockResolvedValue([]);
  H.closeDeputation.mockResolvedValue(undefined);
});
afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("Deputation — create (depute OUT)", () => {
  describe("POST /v1/hrms/employees/:id/deputations", () => {
    const payload = {
      parentCadre: "Section Officer",
      borrowingDepartment: "Finance Ministry",
      borrowingDepartmentId: "dddddddd-0002-4000-8000-000000000002",
      borrowingManagerId: "eeeeeeee-0002-4000-8000-000000000002",
      deputationAllowanceMinor: 500000,
      tenureFrom: "2025-01-01",
      tenureTo: "2027-12-31",
    };

    it("creates a deputation (201)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(), payload });
      expect(r.statusCode).toBe(201);
      expect(r.json().status).toBe("active");
      expect(r.json().employeeId).toBe(EMP);
      expect(r.json().parentCadre).toBe("Section Officer");
      await app.close();
    });

    it("returns 400 on invalid payload (missing parentCadre)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(), payload: { borrowingDepartment: "X" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("VALIDATION_FAILED");
      await app.close();
    });

    it("returns 400 when tenureTo is before tenureFrom", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(),
        payload: { ...payload, tenureFrom: "2027-01-01", tenureTo: "2025-01-01" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("INVALID_TENURE");
      await app.close();
    });

    it("returns 400 on invalid UUID param", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/bad-uuid/deputations`, headers: auth(), payload });
      expect(r.statusCode).toBe(400);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, payload });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(USER, ["employee"]), payload });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when employee not found", async () => {
      H.selectFrom.mockResolvedValue([]);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(), payload });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });

    it("returns 409 when employee already has an active deputation", async () => {
      H.findActiveByEmployee.mockResolvedValue(deputation());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(), payload });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("ALREADY_DEPUTED");
      await app.close();
    });
  });
});

describe("Deputation — list for employee", () => {
  describe("GET /v1/hrms/employees/:id/deputations", () => {
    it("lists deputations (200)", async () => {
      H.listByEmployee.mockResolvedValue([deputation()]);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().data).toHaveLength(1);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/deputations` });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/deputations`, headers: auth(USER, ["employee"]) });
      expect(r.statusCode).toBe(403);
      await app.close();
    });
  });
});

describe("Deputation — read one", () => {
  describe("GET /v1/hrms/deputations/:depId", () => {
    it("reads a single deputation (200)", async () => {
      H.findById.mockResolvedValue(deputation());
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/deputations/${DEP}`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe(DEP);
      await app.close();
    });

    it("returns 404 when deputation not found", async () => {
      H.findById.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/deputations/${DEP}`, headers: auth() });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });
  });
});

describe("Deputation — repatriate", () => {
  describe("POST /v1/hrms/deputations/:depId/repatriate", () => {
    it("repatriates an active deputation (200)", async () => {
      H.findById.mockResolvedValue(deputation());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/repatriate`, headers: auth(), payload: { repatriatedOn: "2026-06-01" } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("repatriated");
      expect(r.json().effectiveDate).toBe("2026-06-01");
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/repatriate`, payload: {} });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 404 when deputation not found", async () => {
      H.findById.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/repatriate`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });

    it("returns 409 when deputation is not active", async () => {
      H.findById.mockResolvedValue(deputation({ status: "repatriated" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/repatriate`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("NOT_ACTIVE");
      await app.close();
    });
  });
});

describe("Deputation — cancel", () => {
  describe("POST /v1/hrms/deputations/:depId/cancel", () => {
    it("cancels an active deputation (200)", async () => {
      H.findById.mockResolvedValue(deputation());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/cancel`, headers: auth(), payload: { note: "transfer order revoked" } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe("cancelled");
      await app.close();
    });

    it("returns 409 when deputation already cancelled", async () => {
      H.findById.mockResolvedValue(deputation({ status: "cancelled" }));
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/cancel`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("NOT_ACTIVE");
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/deputations/${DEP}/cancel`, headers: auth(USER, ["employee"]), payload: {} });
      expect(r.statusCode).toBe(403);
      await app.close();
    });
  });
});

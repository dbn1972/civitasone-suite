/**
 * Route-level tests for Agent 1 HRMS gap-closure features:
 * 0175 — fitness_status, 0176 — COI declarations, 0180 — activation gate,
 * 0195 — no-show reversal, 0227 — functional/project managers,
 * 0230 — cycle detection, 0233 — span-of-control, 0314 — hold/release
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const USER2 = "aaaaaaaa-2222-4000-8000-000000000002";
const EMP_ID = "eeeeeeee-0001-4000-8000-000000000001";
const EMP_ID2 = "eeeeeeee-0002-4000-8000-000000000002";
const DECL_ID = "dddddddd-0001-4000-8000-000000000001";
const HOLD_ID = "abababab-0001-4000-8000-000000000001";

// --- Mock setup ---
const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
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
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
        if (H.transaction.getMockImplementation()) return H.transaction(cb);
        return cb(mockTx);
      },
    },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock: employee exists
  H.selectFrom.mockResolvedValue([{
    id: EMP_ID, tenantId: TENANT, fullName: "Test Emp", status: "probation",
    fitnessStatus: "fit", departmentId: "dept-1", designationId: "desig-1",
    dateOfJoining: "2026-01-15", bankAccountNo: "1234", pan: "PAN123",
    employeeType: "permanent", version: 1, managerId: null,
  }]);
  H.update.mockResolvedValue(undefined);
  H.insert.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("0175 — PATCH /v1/hrms/employees/:id/fitness-status", () => {
  it("updates fitness_status (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/fitness-status`,
      headers: auth(),
      payload: { fitnessStatus: "fit" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.fitnessStatus).toBe("fit");
    await app.close();
  });

  it("rejects invalid fitness_status (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/fitness-status`,
      headers: auth(),
      payload: { fitnessStatus: "invalid_value" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/fitness-status`,
      payload: { fitnessStatus: "fit" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for non-HR role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/fitness-status`,
      headers: auth(USER, ["employee"]),
      payload: { fitnessStatus: "fit" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 for unknown employee", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/fitness-status`,
      headers: auth(),
      payload: { fitnessStatus: "fit" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("0180 — POST /v1/hrms/employees/:id/activate", () => {
  it("activates employee when all conditions met (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("blocks activation when fitness is pending (422)", async () => {
    H.selectFrom.mockResolvedValue([{
      id: EMP_ID, tenantId: TENANT, fullName: "Test", status: "probation",
      fitnessStatus: "pending", departmentId: "dept-1", designationId: "desig-1",
      dateOfJoining: "2026-01-15", bankAccountNo: "1234", pan: "PAN",
      employeeType: "permanent", version: 1,
    }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ACTIVATION_BLOCKED");
    expect(r.json().failures.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns 409 if already active", async () => {
    H.selectFrom.mockResolvedValue([{
      id: EMP_ID, tenantId: TENANT, fullName: "Test", status: "active",
      fitnessStatus: "fit", departmentId: "dept-1", designationId: "desig-1",
      dateOfJoining: "2026-01-15", bankAccountNo: "1234", pan: "PAN",
      employeeType: "permanent", version: 1,
    }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ALREADY_ACTIVE");
    await app.close();
  });

  it("returns 404 for unknown employee", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/activate`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("0195 — POST /v1/hrms/employees/:id/reverse-no-show", () => {
  it("reverses no-show to probation (200)", async () => {
    H.selectFrom.mockResolvedValue([{ id: EMP_ID, status: "no_show", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/reverse-no-show`,
      headers: auth(),
      payload: { reason: "Employee reported late due to transport issue" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("probation");
    await app.close();
  });

  it("allows reverting to active status", async () => {
    H.selectFrom.mockResolvedValue([{ id: EMP_ID, status: "no_show", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/reverse-no-show`,
      headers: auth(),
      payload: { reason: "Clerical error", revertToStatus: "active" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 409 if employee is not in no_show status", async () => {
    H.selectFrom.mockResolvedValue([{ id: EMP_ID, status: "active", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/reverse-no-show`,
      headers: auth(),
      payload: { reason: "Test" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("returns 400 without reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/reverse-no-show`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("0227 + 0230 — PATCH /v1/hrms/employees/:id/managers", () => {
  beforeEach(() => {
    // Return employee + all edges for cycle detection
    H.selectFrom.mockImplementation((...args: unknown[]) => {
      // First call: fetch employee; subsequent calls for edge list
      return Promise.resolve([{ id: EMP_ID, version: 1, managerId: null, tenantId: TENANT, eid: EMP_ID, mgr: null }]);
    });
  });

  it("assigns functional and project managers (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/managers`,
      headers: auth(),
      payload: { functionalManagerId: EMP_ID2, projectManagerId: EMP_ID2 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.functionalManagerId).toBe(EMP_ID2);
    await app.close();
  });

  it("detects cycle on manager assignment (422)", async () => {
    // Set up: EMP_ID2 reports to EMP_ID (so making EMP_ID2 the manager of EMP_ID creates a cycle)
    H.selectFrom.mockImplementation((...args: unknown[]) => {
      return Promise.resolve([
        { id: EMP_ID, version: 1, managerId: null, tenantId: TENANT, eid: EMP_ID, mgr: null },
        { id: EMP_ID2, version: 1, managerId: EMP_ID, tenantId: TENANT, eid: EMP_ID2, mgr: EMP_ID },
      ]);
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/managers`,
      headers: auth(),
      payload: { managerId: EMP_ID2 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    await app.close();
  });

  it("returns 400 without any manager field", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/managers`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 for unknown employee", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/employees/${EMP_ID}/managers`,
      headers: auth(),
      payload: { managerId: EMP_ID2 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("0233 — GET /v1/hrms/analytics/span-of-control", () => {
  it("returns analytics data (200)", async () => {
    H.execute.mockResolvedValue([
      { manager_id: EMP_ID, manager_name: "Boss", department_id: "dept-1", direct_reports: 5, reporting_line_reports: 3, functional_reports: 1, project_reports: 1 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/analytics/span-of-control",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeInstanceOf(Array);
    await app.close();
  });

  it("accepts departmentId filter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/analytics/span-of-control?departmentId=aaaaaaaa-0001-4000-8000-000000000001",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/analytics/span-of-control",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/analytics/span-of-control",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("0176 — COI / confidentiality declarations", () => {
  it("POST /v1/hrms/employees/:id/declarations → 201", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/declarations`,
      headers: auth(),
      payload: { declarationType: "coi", declarationDate: "2026-07-01", details: "Business interest in vendor XYZ" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.declarationType).toBe("coi");
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("GET /v1/hrms/employees/:id/declarations → 200", async () => {
    H.selectFrom.mockResolvedValue([
      { id: DECL_ID, employeeId: EMP_ID, declarationType: "coi", status: "active", declarationDate: "2026-07-01" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/declarations`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeInstanceOf(Array);
    await app.close();
  });

  it("POST /v1/hrms/declarations/:declId/revoke → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: DECL_ID, status: "active", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/declarations/${DECL_ID}/revoke`,
      headers: auth(),
      payload: { reason: "No longer relevant" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("revoked");
    await app.close();
  });

  it("POST revoke returns 409 for already revoked", async () => {
    H.selectFrom.mockResolvedValue([{ id: DECL_ID, status: "revoked", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/declarations/${DECL_ID}/revoke`,
      headers: auth(),
      payload: { reason: "Test" },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("POST /v1/hrms/declarations/:declId/acknowledge → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: DECL_ID, status: "active", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/declarations/${DECL_ID}/acknowledge`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.acknowledged).toBe(true);
    await app.close();
  });

  it("rejects invalid declaration type (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/declarations`,
      headers: auth(),
      payload: { declarationType: "invalid", declarationDate: "2026-07-01", details: "x" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("0314 — Employee hold/release", () => {
  it("POST /v1/hrms/employees/:id/holds → 201", async () => {
    H.selectFrom.mockResolvedValue([{ id: EMP_ID }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/holds`,
      headers: auth(),
      payload: { holdType: "salary", reason: "Pending inquiry", effectiveFrom: "2026-08-01" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.holdType).toBe("salary");
    expect(r.json().data.status).toBe("pending");
    await app.close();
  });

  it("GET /v1/hrms/employees/:id/holds → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, holdType: "salary", status: "active" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/holds`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeInstanceOf(Array);
    await app.close();
  });

  it("POST /v1/hrms/holds/:holdId/approve → 200 (SoD enforced)", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, status: "pending", requestedBy: USER2, version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/holds/${HOLD_ID}/approve`,
      headers: auth(USER, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("POST /v1/hrms/holds/:holdId/approve → 403 SoD violation (requester = approver)", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, status: "pending", requestedBy: USER, version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/holds/${HOLD_ID}/approve`,
      headers: auth(USER, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("POST /v1/hrms/holds/:holdId/reject → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, status: "pending", requestedBy: USER2, version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/holds/${HOLD_ID}/reject`,
      headers: auth(),
      payload: { reason: "Not justified" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("rejected");
    await app.close();
  });

  it("POST /v1/hrms/holds/:holdId/release → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, status: "active", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/holds/${HOLD_ID}/release`,
      headers: auth(),
      payload: { reason: "Inquiry concluded, no action" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("released");
    await app.close();
  });

  it("POST release returns 409 for wrong state", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, status: "released", version: 1 }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/holds/${HOLD_ID}/release`,
      headers: auth(),
      payload: { reason: "Test" },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("GET /v1/hrms/holds/active → 200", async () => {
    H.selectFrom.mockResolvedValue([{ id: HOLD_ID, holdType: "salary", status: "active" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/holds/active",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeInstanceOf(Array);
    await app.close();
  });

  it("rejects invalid hold type (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/employees/${EMP_ID}/holds`,
      headers: auth(),
      payload: { holdType: "invalid", reason: "x", effectiveFrom: "2026-08-01" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

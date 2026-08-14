/**
 * Self-service route-level tests — employee-facing "me" endpoints:
 * GET /v1/hrms/me/profile
 * GET /v1/hrms/me/leave-balance
 * GET /v1/hrms/me/attendance
 * GET /v1/hrms/me/leave-applications
 *
 * Happy paths, 401, 404 (no linked employee record).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER   = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const selectResult = (mockFn: (...a: unknown[]) => unknown, ...args: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const resolve = () => H.selectFrom(...args);
    chain.from = () => ({
      where: (...w: unknown[]) => ({
        limit: () => ({ then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise.resolve(H.selectFrom(...w)).then(r, j) }),
        orderBy: () => ({ limit: () => ({ then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise.resolve(H.selectFrom(...w)).then(r, j) }) }),
        then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise.resolve(H.selectFrom(...w)).then(r, j),
      }),
      orderBy: () => ({ limit: () => ({ then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise.resolve(resolve()).then(r, j) }) }),
      then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise.resolve(resolve()).then(r, j),
    });
    return chain;
  };

  const mockTx = {
    select: (...args: unknown[]) => selectResult(H.selectFrom, ...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };

  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
      execute: (q: unknown) => H.execute(q),
    },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
    listKey: (...a: string[]) => a.join(":"),
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["employee"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["employee"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

const EMPLOYEE_ROW = {
  id: EMP_ID,
  tenantId: TENANT,
  userRef: USER,
  employeeNo: "EMP001",
  fullName: "Ravi Kumar",
  email: "ravi@test.gov.in",
  departmentId: "dddddddd-0001-4000-8000-000000000001",
  designationId: "dddddddd-0002-4000-8000-000000000002",
  status: "active",
  dateOfJoining: "2025-01-01",
  managerId: null,
  basicMinor: 5000000,
  mobile: null,
  aadhaarHash: null,
  panHash: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/me/profile ────────────────────────────────────────────────

describe("GET /v1/hrms/me/profile", () => {
  it("200 — returns employee profile for linked user", async () => {
    H.selectFrom.mockResolvedValue([EMPLOYEE_ROW]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/profile",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe(EMP_ID);
    expect(body.fullName).toBe("Ravi Kumar");
    await app.close();
  });

  it("404 — no employee linked to this user", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/profile",
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/me/profile" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ─── GET /v1/hrms/me/leave-balance ─────────────────────────────────────────

describe("GET /v1/hrms/me/leave-balance", () => {
  it("200 — returns empty leave balance when no allocations", async () => {
    H.selectFrom
      .mockResolvedValueOnce([EMPLOYEE_ROW]) // employee lookup
      .mockResolvedValue([]);                 // leave allocs
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-balance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });

  it("200 — returns leave allocation shape", async () => {
    const alloc = {
      leaveTypeId: "llllllll-0001-4000-8000-000000000001",
      fy: "2026-27",
      totalDays: 12,
      balanceDays: 9,
    };
    H.selectFrom
      .mockResolvedValueOnce([EMPLOYEE_ROW])
      .mockResolvedValue([alloc]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-balance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].total).toBe(12);
    expect(body.data[0].used).toBe(3);
    await app.close();
  });

  it("404 — no employee linked", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-balance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/me/leave-balance" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ─── GET /v1/hrms/me/attendance ─────────────────────────────────────────────

describe("GET /v1/hrms/me/attendance", () => {
  it("200 — returns attendance records for the employee", async () => {
    const record = {
      attendanceDate: "2026-08-01",
      status: "present",
      inTime: "09:00",
      outTime: "18:00",
      employeeId: EMP_ID,
      tenantId: TENANT,
    };
    H.selectFrom
      .mockResolvedValueOnce([EMPLOYEE_ROW])
      .mockResolvedValue([record]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/attendance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("data");
    expect(body.data[0].status).toBe("present");
    await app.close();
  });

  it("404 — no employee linked", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/attendance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/me/attendance" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ─── GET /v1/hrms/me/leave-applications ─────────────────────────────────────

describe("GET /v1/hrms/me/leave-applications", () => {
  it("200 — returns leave applications for the employee", async () => {
    const leaveApp = {
      id: "llllllll-aaaa-4000-8000-000000000001",
      leaveTypeId: "llllllll-0001-4000-8000-000000000001",
      fromDate: "2026-08-05",
      toDate: "2026-08-06",
      daysApplied: 2,
      status: "pending",
      employeeId: EMP_ID,
      tenantId: TENANT,
    };
    H.selectFrom
      .mockResolvedValueOnce([EMPLOYEE_ROW])
      .mockResolvedValue([leaveApp]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-applications",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("pending");
    expect(body.data[0].days).toBe(2);
    await app.close();
  });

  it("200 — returns empty array when no applications", async () => {
    H.selectFrom
      .mockResolvedValueOnce([EMPLOYEE_ROW])
      .mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-applications",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("404 — no employee linked", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/leave-applications",
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/me/leave-applications" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

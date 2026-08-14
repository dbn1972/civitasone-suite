/**
 * Dashboard route-level tests — comprehensive coverage:
 * happy paths, 401 unauthenticated, 403 forbidden.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER   = "aaaaaaaa-1111-4000-8000-000000000001";

// ── Hoist query mocks before any vi.mock hoisting ──────────────────────────
const { getDashboardMock, getPendingLeaveInboxMock } = vi.hoisted(() => ({
  getDashboardMock:         vi.fn(),
  getPendingLeaveInboxMock: vi.fn(),
}));

vi.mock("../src/modules/dashboard/queries.js", () => ({
  getDashboard:         (...a: unknown[]) => getDashboardMock(...a),
  getPendingLeaveInbox: (...a: unknown[]) => getPendingLeaveInboxMock(...a),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    execute: async () => [],
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
  sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
}));

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

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

const DASHBOARD_PAYLOAD = {
  headcount: 42,
  headcountLastMonth: 40,
  attendanceTodayPct: 88,
  pendingLeaves: 5,
  onLeave: 3,
  payrollDue: 0,
  departmentBreakdown: [{ name: "Engineering", count: 20 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getDashboardMock.mockResolvedValue(DASHBOARD_PAYLOAD);
  getPendingLeaveInboxMock.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/dashboard ─────────────────────────────────────────────────

describe("GET /v1/hrms/dashboard", () => {
  it("200 — returns dashboard payload with required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("headcount");
    expect(body).toHaveProperty("pendingLeaves");
    expect(body.headcount).toBe(42);
    await app.close();
  });

  it("200 — headcountLastMonth and departmentBreakdown present", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("headcountLastMonth");
    expect(body).toHaveProperty("departmentBreakdown");
    expect(Array.isArray(body.departmentBreakdown)).toBe(true);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — manager role is allowed", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

// ─── GET /v1/hrms/dashboard/pending-leaves ──────────────────────────────────

describe("GET /v1/hrms/dashboard/pending-leaves", () => {
  it("200 — returns empty inbox when no pending leaves", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard/pending-leaves",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
    await app.close();
  });

  it("200 — returns leave inbox items with correct shape", async () => {
    const leaveItem = {
      id: "cccccccc-0001-4000-8000-000000000001",
      employeeName: "Ravi Kumar",
      employeeNo: "EMP001",
      departmentName: "Engineering",
      leaveTypeName: "Casual Leave",
      leaveTypeCode: "CL",
      fromDate: "2026-08-01",
      toDate: "2026-08-02",
      daysApplied: 2,
      status: "pending",
    };
    getPendingLeaveInboxMock.mockResolvedValue([leaveItem]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard/pending-leaves",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].employeeName).toBe("Ravi Kumar");
    expect(body.data[0].leaveTypeCode).toBe("CL");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard/pending-leaves" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard/pending-leaves",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — hr_officer can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dashboard/pending-leaves",
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

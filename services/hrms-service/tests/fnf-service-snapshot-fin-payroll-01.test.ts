/**
 * GAP-PAYROLL-FNF-03 / LOANS-01 (fin-payroll-01):
 * - GET /v1/hrms/internal/fnf-service-snapshot: HR-record-derived completed
 *   years and leave balance that payroll-service holds an F&F compute to.
 * - employee-summaries accepts optional q / ids filters (payroll's name lookup).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { completedYearsOfService, totalLeaveBalanceDays } from "../src/modules/employee/fnf-service-snapshot.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000f1";
const EMP = "bbbbbbbb-1111-4000-8000-0000000000f1";

const { scopedReadMock } = vi.hoisted(() => ({ scopedReadMock: vi.fn() }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => scopedReadMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await (sqlClient as { end: () => Promise<void> }).end(); });
beforeEach(() => scopedReadMock.mockReset());
const auth = (roles = ["payroll_admin"]) => ({ authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s1" }, SECRET)}` });

describe("fnf-service-snapshot helpers", () => {
  it("completed years floor on 365.25-day years and never go negative", () => {
    expect(completedYearsOfService("2000-01-01", "2026-01-01")).toBe(26);
    expect(completedYearsOfService("2000-01-01", "2025-12-31")).toBe(25);
    expect(completedYearsOfService("2026-06-01", "2026-01-01")).toBe(0);
  });
  it("leave balance sums allocations, treating null as 0", () => {
    expect(totalLeaveBalanceDays([{ balanceDays: 10 }, { balanceDays: null }, { balanceDays: 2.5 }])).toBe(12.5);
    expect(totalLeaveBalanceDays([])).toBe(0);
  });
  it("uses the EXACT half-day balance (balance_days_exact) when present, like leave encashment (GAP-HR-LEAVE-APPLY-05)", () => {
    expect(totalLeaveBalanceDays([{ balanceDays: 12, balanceDaysExact: "12.5" }, { balanceDays: 3, balanceDaysExact: null }, { balanceDays: 1 }])).toBe(16.5);
  });
});

describe("GET /v1/hrms/internal/fnf-service-snapshot", () => {
  const url = (id = EMP, d = "2026-02-28") => `/v1/hrms/internal/fnf-service-snapshot?employeeId=${id}&separationDate=${d}`;

  it("returns completed years and leave balance from the HR records", async () => {
    scopedReadMock
      .mockResolvedValueOnce([{ dateOfJoining: "2010-02-01" }])
      .mockResolvedValueOnce([{ balanceDays: 100, balanceDaysExact: null }, { balanceDays: 20, balanceDaysExact: "20.5" }]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: url(), headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ employeeId: EMP, completedYears: 16, leaveBalanceDays: 120.5 });
  });

  it("404 for an unknown employee; 400 for a malformed date; 403 for a plain employee (no read)", async () => {
    scopedReadMock.mockResolvedValueOnce([]);
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: url(), headers: auth() })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: url(EMP, "28-02-2026"), headers: auth() })).statusCode).toBe(400);
    scopedReadMock.mockReset();
    expect((await app.inject({ method: "GET", url: url(), headers: auth(["employee"]) })).statusCode).toBe(403);
    expect(scopedReadMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /v1/hrms/internal/employee-summaries filters", () => {
  it("still answers the unfiltered feed unchanged, and accepts q / ids", async () => {
    for (const qs of ["", "?q=meer", `?ids=${EMP},not-a-uuid`]) {
      scopedReadMock
        .mockResolvedValueOnce([{ id: "e1", fullName: "Meera Iyer", employeeNo: "EMP-1", departmentId: "d1" }])
        .mockResolvedValueOnce([{ id: "d1", name: "Finance" }]);
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: `/v1/hrms/internal/employee-summaries${qs}`, headers: auth() });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: "e1", fullName: "Meera Iyer", employeeNo: "EMP-1", departmentName: "Finance" }]);
    }
  });
  it("rejects an over-long q", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/internal/employee-summaries?q=${"x".repeat(101)}`, headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

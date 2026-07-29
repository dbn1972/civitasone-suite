/**
 * DEF-AT-001 (T&A-ATM-0247) — attendance period lock / payroll cut-off.
 * Route-level proof that:
 *   • marking attendance for a locked month is rejected (422 ATTENDANCE_LOCKED)
 *   • marking attendance for an open month is accepted (202)
 *   • creating a regularisation in a locked month is rejected (422)
 *   • lock/unlock endpoints require the elevated LOCK_ROLES (403 otherwise)
 *   • GET locks returns the current lock list
 *
 * repo (lock lookup) and commands are mocked; the real route wiring + RBAC runs.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000d1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000d1";
const EMP = "33333333-3333-4000-8000-0000000000d3";

const { lockedPeriodsMock, markMock, regMock, lockMock, unlockMock, listLocksMock } = vi.hoisted(() => ({
  lockedPeriodsMock: vi.fn(),
  markMock: vi.fn(),
  regMock: vi.fn(),
  lockMock: vi.fn(),
  unlockMock: vi.fn(),
  listLocksMock: vi.fn(),
}));

vi.mock("../src/modules/attendance/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findLockedPeriods: (...a: unknown[]) => lockedPeriodsMock(...a),
}));
vi.mock("../src/modules/attendance/commands.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  markAttendance: (...a: unknown[]) => markMock(...a),
  createRegularisation: (...a: unknown[]) => regMock(...a),
  lockPeriod: (...a: unknown[]) => lockMock(...a),
  unlockPeriod: (...a: unknown[]) => unlockMock(...a),
}));
vi.mock("../src/modules/attendance/queries.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listAttendanceLocks: (...a: unknown[]) => listLocksMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const accepted = { id: "x", status: "accepted", correlationId: "c" };
const token = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s1" }, SECRET);
const markBody = { records: [{ employeeId: EMP, attendanceDate: "2026-06-15", status: "present" }] };
const regBody = { employeeId: EMP, date: "2026-06-15", requestedStatus: "present", reason: "missed punch" };

beforeEach(() => {
  vi.clearAllMocks();
  lockedPeriodsMock.mockResolvedValue([]);
  markMock.mockResolvedValue({ ...accepted, batchId: "b", count: 1 });
  regMock.mockResolvedValue(accepted);
  lockMock.mockResolvedValue(accepted);
  unlockMock.mockResolvedValue(accepted);
  listLocksMock.mockResolvedValue([{ id: "l1", period: "2026-06", status: "locked" }]);
});

afterAll(async () => { await sqlClient.end(); });

describe("attendance period lock (DEF-AT-001)", () => {
  it("rejects marking attendance in a locked period (422 ATTENDANCE_LOCKED)", async () => {
    lockedPeriodsMock.mockResolvedValueOnce(["2026-06"]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` }, payload: markBody,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ATTENDANCE_LOCKED");
    expect(markMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts marking attendance in an open period (202)", async () => {
    lockedPeriodsMock.mockResolvedValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` }, payload: markBody,
    });
    expect(r.statusCode).toBe(202);
    expect(markMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a regularisation in a locked period (422)", async () => {
    lockedPeriodsMock.mockResolvedValueOnce(["2026-06"]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/regularisations",
      headers: { authorization: `Bearer ${token(["manager"])}` }, payload: regBody,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ATTENDANCE_LOCKED");
    expect(regMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("locks a period for an authorised officer (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/locks",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
      payload: { period: "2026-06", reason: "payroll run closed" },
    });
    expect(r.statusCode).toBe(202);
    expect(lockMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids a manager (non-LOCK_ROLE) from locking a period (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/locks",
      headers: { authorization: `Bearer ${token(["manager"])}` },
      payload: { period: "2026-06" },
    });
    expect(r.statusCode).toBe(403);
    expect(lockMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("unlocks a period for an authorised officer (202)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/locks/unlock",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
      payload: { period: "2026-06", reason: "correction window" },
    });
    expect(r.statusCode).toBe(202);
    expect(unlockMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects an invalid period format (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/attendance/locks",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
      payload: { period: "2026/06" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("requires auth for lock listing (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/locks" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("lists current locks for an authorised reader (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/attendance/locks",
      headers: { authorization: `Bearer ${token(["manager"])}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].period).toBe("2026-06");
    await app.close();
  });
});

/**
 * DEF-LM-002 (T&A-LM-0283) — route-level proof that the leave apply flow REJECTS
 * a new application whose dates overlap an existing pending/approved leave for the
 * same employee (422 LEAVE_OVERLAP), and ACCEPTS one with no clash (202).
 *
 * repo / db / command boundaries are mocked; the real enforceCcsLeaveRules logic
 * (eligibility gate + overlap guard) runs.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000c1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000c1";
const EMP = "33333333-3333-4000-8000-0000000000c3";
const LEAVE_TYPE = "44444444-4444-4000-8000-0000000000c4";
const ALLOC = "55555555-5555-4000-8000-0000000000c5";

const { scopedReadMock, applyLeaveMock, loadTypeResolverMock, overlapMock } = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  applyLeaveMock: vi.fn(),
  loadTypeResolverMock: vi.fn(),
  overlapMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => scopedReadMock(...a),
}));
vi.mock("../src/modules/leave/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findAllocById: async () => ({ id: ALLOC, balanceDays: 30, totalDays: 30 }),
  listLeaveTypesByTenant: async () => [{ id: LEAVE_TYPE, code: "EOL" }],
  findOverlappingLeaveApps: (...a: unknown[]) => overlapMock(...a),
}));
vi.mock("../src/modules/leave/commands.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  applyLeave: (...a: unknown[]) => applyLeaveMock(...a),
}));
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  return { ...actual, loadTypeResolver: (...a: unknown[]) => loadTypeResolverMock(...a) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { buildTypeResolver } from "../src/modules/employee/engagement-policy.js";

const CANON = [{ category: "pay_scale", eligibleForLeave: true }];

const body = {
  employeeId: EMP, leaveTypeId: LEAVE_TYPE, allocId: ALLOC,
  fromDate: "2026-08-10", toDate: "2026-08-14", daysApplied: 5, reason: "x",
};
const token = () => signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  scopedReadMock.mockImplementation(async () => [
    { id: EMP, employeeType: "pay_scale", dateOfJoining: "2020-01-01", status: "active" },
  ]);
  applyLeaveMock.mockResolvedValue({ id: "leave-1", status: "accepted", correlationId: "c" });
  loadTypeResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
  overlapMock.mockResolvedValue([]);
});

afterAll(async () => { await sqlClient.end(); });

describe("leave apply — date overlap guard (DEF-LM-002)", () => {
  it("rejects an application overlapping an existing pending leave (422 LEAVE_OVERLAP)", async () => {
    overlapMock.mockResolvedValueOnce([
      { id: "clash-1", status: "pending", fromDate: "2026-08-12", toDate: "2026-08-16" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("LEAVE_OVERLAP");
    expect(applyLeaveMock).not.toHaveBeenCalled();
    // overlap query was scoped to this employee + requested date range
    expect(overlapMock).toHaveBeenCalledWith(TENANT, EMP, body.fromDate, body.toDate);
    await app.close();
  });

  it("rejects an application overlapping an existing approved leave", async () => {
    overlapMock.mockResolvedValueOnce([
      { id: "clash-2", status: "approved", fromDate: "2026-08-01", toDate: "2026-08-11" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("LEAVE_OVERLAP");
    expect(applyLeaveMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts an application with no overlapping leave (202)", async () => {
    overlapMock.mockResolvedValueOnce([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(202);
    expect(applyLeaveMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("guards the leave-requests alias route as well", async () => {
    overlapMock.mockResolvedValueOnce([
      { id: "clash-3", status: "pending", fromDate: "2026-08-13", toDate: "2026-08-13" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("LEAVE_OVERLAP");
    await app.close();
  });
});

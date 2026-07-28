/**
 * Route-level proof that the leave apply flow REJECTS an engagement type that is
 * not entitled to the salaried leave scheme (consultant / third_party) and
 * ACCEPTS an eligible one (pay_scale). The gate runs for every leave code — here
 * an 'EOL' type (outside the CCS rules engine) isolates the engagement gate.
 *
 * repo / db / command boundaries are mocked; the real leaveEligible gating runs.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000b1";
const EMP = "33333333-3333-4000-8000-000000000003";
const LEAVE_TYPE = "44444444-4444-4000-8000-000000000004";
const ALLOC = "55555555-5555-4000-8000-000000000005";

const { scopedReadMock, applyLeaveMock, loadTypeResolverMock, empTypeHolder } = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  applyLeaveMock: vi.fn(),
  loadTypeResolverMock: vi.fn(),
  empTypeHolder: { type: "pay_scale" },
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => scopedReadMock(...a),
}));
vi.mock("../src/modules/leave/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findAllocById: async () => ({ id: ALLOC, balanceDays: 30, totalDays: 30 }),
  listLeaveTypesByTenant: async () => [{ id: LEAVE_TYPE, code: "EOL" }],
}));
vi.mock("../src/modules/leave/commands.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  applyLeave: (...a: unknown[]) => applyLeaveMock(...a),
}));
// Keep the REAL leaveEligible / buildTypeResolver; stub only the DB-backed loader.
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  return { ...actual, loadTypeResolver: (...a: unknown[]) => loadTypeResolverMock(...a) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { buildTypeResolver } from "../src/modules/employee/engagement-policy.js";

const CANON = [
  { category: "pay_scale",  eligibleForLeave: true },
  { category: "consultant", eligibleForLeave: false },
];

const body = {
  employeeId: EMP, leaveTypeId: LEAVE_TYPE, allocId: ALLOC,
  fromDate: "2026-07-06", toDate: "2026-07-06", daysApplied: 1, reason: "x",
};
const token = () => signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  scopedReadMock.mockImplementation(async () => [
    { id: EMP, employeeType: empTypeHolder.type, dateOfJoining: "2020-01-01", status: "active" },
  ]);
  applyLeaveMock.mockResolvedValue({ id: "leave-1", status: "accepted", correlationId: "c" });
  loadTypeResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
});

afterAll(async () => { await sqlClient.end(); });

describe("leave apply — engagement eligibility gate", () => {
  it("rejects a consultant with 422 LEAVE_NOT_ELIGIBLE and never applies", async () => {
    empTypeHolder.type = "consultant";
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("LEAVE_NOT_ELIGIBLE");
    expect(applyLeaveMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts an eligible pay_scale employee", async () => {
    empTypeHolder.type = "pay_scale";
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(202);
    expect(applyLeaveMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("fails OPEN — a resolver error never blocks a legitimate application", async () => {
    // Even for a consultant, if the resolver throws the gate must not block:
    // a transient DB failure should not deny an employee their leave.
    empTypeHolder.type = "consultant";
    loadTypeResolverMock.mockRejectedValueOnce(new Error("db down"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token()}` }, payload: body,
    });
    expect(r.statusCode).toBe(202);
    expect(applyLeaveMock).toHaveBeenCalledOnce();
    await app.close();
  });
});

/**
 * MEDIUM regression: HRMS has a full overtime request/approve workflow
 * (attendance module's hrmsOvertimeRequests + /v1/hrms/overtime-requests
 * routes) but payroll-service never referenced it anywhere -- approved
 * overtime was tracked and never surfaced to payroll at all. This covers
 * the surfacing half: GET /v1/hrms/internal/payroll-input now includes an
 * `overtimeHours` map (employeeId -> approved hours for the month), mirroring
 * the existing `lopDays` map. Mirrors payroll-input-pagination.test.ts's
 * mocking harness.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000a1";

const {
  listByTenantMock, findApprovedLeaveMock, findAttendanceMock, paySuspendedMock, findApprovedOvertimeMock,
} = vi.hoisted(() => ({
  listByTenantMock: vi.fn(),
  findApprovedLeaveMock: vi.fn(),
  findAttendanceMock: vi.fn(),
  paySuspendedMock: vi.fn(),
  findApprovedOvertimeMock: vi.fn(),
}));

function emp(i: number) {
  return {
    id: `emp-${i}`, employeeNo: `E-${i}`, fullName: `Employee ${i}`, basicMinor: 5000000,
    payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uanNumber: null,
    esicIpNumber: null, pran: null, hraCityClass: "X", taxRegime: "new", departmentId: null,
    pensionScheme: "NPS", status: "active", employeeType: "pay_scale",
  };
}
const EMPLOYEES = [emp(0), emp(1)];

vi.mock("../src/modules/employee/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listByTenant: (...a: unknown[]) => listByTenantMock(...a),
}));
vi.mock("../src/modules/leave/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApprovedLeaveInMonth: (...a: unknown[]) => findApprovedLeaveMock(...a),
}));
vi.mock("../src/modules/attendance/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findByEmpAndMonth: (...a: unknown[]) => findAttendanceMock(...a),
  findByEmpsAndMonth: async (_tenantId: string, employeeIds: string[], _month: string) => {
    const rows = await findAttendanceMock();
    return new Map(employeeIds.map((id) => [id, rows]));
  },
  findApprovedOvertimeInMonth: (...a: unknown[]) => findApprovedOvertimeMock(...a),
}));
vi.mock("../src/modules/disciplinary/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  activePaySuspendedEmployeeIds: (...a: unknown[]) => paySuspendedMock(...a),
}));
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  const CANON = [
    { category: "pay_scale", eligibleForPayroll: true, attendanceMode: "muster_lop", paymentRoute: "payroll" },
  ];
  return { ...actual, loadTypeResolver: async () => actual.buildTypeResolver([], CANON) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

beforeEach(() => {
  vi.clearAllMocks();
  listByTenantMock.mockImplementation(async (_tenantId: string, limit = 100, offset = 0) =>
    EMPLOYEES.slice(offset, offset + limit),
  );
  findApprovedLeaveMock.mockResolvedValue([]);
  findAttendanceMock.mockResolvedValue([]);
  paySuspendedMock.mockResolvedValue(new Map());
  findApprovedOvertimeMock.mockResolvedValue(new Map());
});

afterAll(async () => { await sqlClient.end(); });

describe("MEDIUM: payroll-input feed surfaces approved overtime hours", () => {
  it("includes an overtimeHours map keyed by employeeId", async () => {
    findApprovedOvertimeMock.mockResolvedValue(new Map([["emp-0", 6.5], ["emp-1", 0]]));
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-07",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();

    expect(findApprovedOvertimeMock).toHaveBeenCalledWith(TENANT, "2026-07");
    expect(body.overtimeHours).toEqual({ "emp-0": 6.5, "emp-1": 0 });
    await app.close();
  });

  it("defaults to an empty overtimeHours map when nobody has approved overtime", async () => {
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-07",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().overtimeHours).toEqual({});
    await app.close();
  });
});

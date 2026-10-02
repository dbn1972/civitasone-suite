/**
 * FR 53 (payroll paid suspended employees full salary): the payroll-input
 * feed now carries, for a pay-suspended employee, the suspension window and
 * any recorded review order (additive `suspension` object), plus every
 * employee's engagement `payMode` so payroll can tell the government
 * pay-scale model (FR 53) from contract/CTC pay (withhold + flag). Mirrors
 * payroll-input-overtime.test.ts's mocking harness.
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

describe("FR 53: payroll-input feed carries suspension window, review order and payMode", () => {
  it("adds suspension details only for the pay-suspended employee, payMode for everyone", async () => {
    paySuspendedMock.mockResolvedValue(new Map([["emp-1", {
      suspensionId: "5a5a5a5a-1111-4000-8000-000000000001", fromDate: "2026-05-01", toDate: null,
      subsistencePct: "50.00", revisedSubsistencePct: "75.00", revisedEffectiveFrom: "2026-07-30", reviewOrderRef: "VIG/2026/7",
    }]]));
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-09",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const [e0, e1] = r.json().employees;
    expect(e0).toMatchObject({ id: "emp-0", paySuspended: false, payMode: "monthly" });
    expect(e0).not.toHaveProperty("suspension");
    expect(e1).toMatchObject({
      id: "emp-1", paySuspended: true, subsistencePct: 50, payMode: "monthly",
      suspension: {
        suspensionId: "5a5a5a5a-1111-4000-8000-000000000001", fromDate: "2026-05-01", toDate: null,
        revisedSubsistencePct: 75, revisedEffectiveFrom: "2026-07-30", reviewOrderRef: "VIG/2026/7",
      },
    });
    await app.close();
  });
});

/**
 * Route-level proof that the payroll-input feed EXCLUDES non-salary-muster
 * engagement types from LOP accrual (DIC attendance applicability).
 *
 * A pay_scale employee (muster_lop) and a consultant (attendance_mode 'none')
 * each get an approved LOP leave AND an absent attendance row for the month.
 * The consultant's absence must never dock a salary they aren't paid through, so
 * `lopDays` must contain the pay_scale employee's id and NOT the consultant's.
 *
 * Repos + loadTypeResolver are mocked to control the population; the real
 * attendanceLopApplies / buildTypeResolver gating runs unmocked.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000a1";
const MUSTER_EMP = "11111111-1111-4000-8000-000000000001"; // pay_scale
const CONSULT_EMP = "22222222-2222-4000-8000-000000000002"; // consultant

const { listByTenantMock, findApprovedLeaveMock, findAttendanceMock, paySuspendedMock } = vi.hoisted(() => ({
  listByTenantMock: vi.fn(),
  findApprovedLeaveMock: vi.fn(),
  findAttendanceMock: vi.fn(),
  paySuspendedMock: vi.fn(),
}));

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
}));
vi.mock("../src/modules/disciplinary/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  activePaySuspendedEmployeeIds: (...a: unknown[]) => paySuspendedMock(...a),
}));
// Keep the REAL attendanceLopApplies / buildTypeResolver; only stub the DB-backed
// resolver loader with a controlled canonical catalogue.
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  const CANON = [
    { category: "pay_scale",  eligibleForPayroll: true,  attendanceMode: "muster_lop", paymentRoute: "payroll" },
    { category: "consultant", eligibleForPayroll: false, attendanceMode: "none",       paymentRoute: "invoice" },
  ];
  return { ...actual, loadTypeResolver: async () => actual.buildTypeResolver([], CANON) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

function emp(id: string, employeeType: string) {
  return {
    id, employeeNo: `E-${id.slice(0, 4)}`, fullName: "Test", basicMinor: 5000000,
    payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uanNumber: null,
    esicIpNumber: null, pran: null, hraCityClass: "X", taxRegime: "new", departmentId: null,
    pensionScheme: "NPS", status: "active", employeeType,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listByTenantMock.mockResolvedValue([emp(MUSTER_EMP, "pay_scale"), emp(CONSULT_EMP, "consultant")]);
  // Both employees have an approved LOP leave (1 working day, Mon 2026-07-06).
  findApprovedLeaveMock.mockResolvedValue([
    { employeeId: MUSTER_EMP, fromDate: "2026-07-06", toDate: "2026-07-06" },
    { employeeId: CONSULT_EMP, fromDate: "2026-07-06", toDate: "2026-07-06" },
  ]);
  // Both employees have an absent attendance row.
  findAttendanceMock.mockResolvedValue([{ status: "absent" }]);
  paySuspendedMock.mockResolvedValue(new Map());
});

afterAll(async () => { await sqlClient.end(); });

describe("payroll-input LOP excludes non-muster engagement types", () => {
  it("accrues LOP for the pay_scale employee but never for the consultant", async () => {
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-07",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // pay_scale employee accrued LOP (1 leave day + 1 absent = 2)
    expect(body.lopDays[MUSTER_EMP]).toBe(2);
    // consultant excluded entirely — no salary LOP from an informational muster
    expect(body.lopDays[CONSULT_EMP]).toBeUndefined();
    // the consultant is still in the projection, tagged as not payroll-eligible
    const consultant = body.employees.find((e: { id: string }) => e.id === CONSULT_EMP);
    expect(consultant.eligibleForPayroll).toBe(false);
    expect(consultant.attendanceMode).toBe("none");
    await app.close();
  });
});

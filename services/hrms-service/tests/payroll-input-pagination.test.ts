/**
 * BUG-1 regression: the payroll-input feed IS the complete payroll-input set
 * for the run (payroll-service's fetchPayrollInput() does no pagination of
 * its own -- see hrms-client.ts). The route used to call
 * `employeeRepo.listByTenant(tenantId, 500, 0)` with a hardcoded limit and
 * offset 0, silently dropping every employee past the 500th with no error,
 * no truncation flag, and no way for payroll-service to notice -- they just
 * never got paid.
 *
 * Seeds (mocks) 650 active employees for one tenant and asserts the route
 * returns all 650, not just the first 500.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000a1";
const TOTAL_EMPLOYEES = 650; // > the old hardcoded 500-row cap

const { listByTenantMock, findApprovedLeaveMock, findAttendanceMock, paySuspendedMock } = vi.hoisted(() => ({
  listByTenantMock: vi.fn(),
  findApprovedLeaveMock: vi.fn(),
  findAttendanceMock: vi.fn(),
  paySuspendedMock: vi.fn(),
}));

function emp(i: number) {
  return {
    id: `emp-${i}`, employeeNo: `E-${i}`, fullName: `Employee ${i}`, basicMinor: 5000000,
    payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uanNumber: null,
    esicIpNumber: null, pran: null, hraCityClass: "X", taxRegime: "new", departmentId: null,
    pensionScheme: "NPS", status: "active", employeeType: "pay_scale",
  };
}
const ALL_EMPLOYEES = Array.from({ length: TOTAL_EMPLOYEES }, (_, i) => emp(i));

vi.mock("../src/modules/employee/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  // Real pagination behavior: honors limit/offset exactly like the real
  // scopedRead-backed implementation, so the route's own paging loop is what's
  // under test here, not a mock that happens to already return everything.
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
  // MEDIUM fix: internal/routes.ts's payroll-input feed now also calls
  // findApprovedOvertimeInMonth. Without this override the spread-real-module
  // default above would run the actual (DB-backed) implementation, which this
  // mock-only test suite has no live Postgres for -- not exercised by this
  // test's assertions, so a plain empty Map.
  findApprovedOvertimeInMonth: async () => new Map<string, number>(),
}));
vi.mock("../src/modules/disciplinary/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  activePaySuspendedEmployeeIds: (...a: unknown[]) => paySuspendedMock(...a),
}));
// Keep the REAL attendanceLopApplies / buildTypeResolver; only stub the
// DB-backed resolver loader (same pattern as payroll-input-engagement-lop.test.ts).
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
  // Faithful pagination mock: slices the full 650-employee set by the
  // (limit, offset) the route actually passes, exactly like the real
  // listByTenant(tenantId, limit, offset) would against a real table.
  listByTenantMock.mockImplementation(async (_tenantId: string, limit = 100, offset = 0) =>
    ALL_EMPLOYEES.slice(offset, offset + limit),
  );
  findApprovedLeaveMock.mockResolvedValue([]);
  findAttendanceMock.mockResolvedValue([]);
  paySuspendedMock.mockResolvedValue(new Map());
});

afterAll(async () => { await sqlClient.end(); });

describe("BUG-1: payroll-input feed pagination", () => {
  it("returns ALL active employees for the tenant, not just the first 500", async () => {
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-07",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();

    expect(body.employees.length).toBe(TOTAL_EMPLOYEES);
    // The specific regression: employees at and past the old hardcoded
    // 500-row cutoff must be present.
    const ids = new Set(body.employees.map((e: { id: string }) => e.id));
    expect(ids.has(emp(499).id)).toBe(true); // last row under the OLD cap
    expect(ids.has(emp(500).id)).toBe(true); // first row the OLD cap dropped
    expect(ids.has(emp(649).id)).toBe(true); // last row overall

    // Paged in two calls of <=500 (500 + 150), not one call for everything
    // and not 650 individual calls -- proves real limit/offset paging, not a
    // raised-but-still-fixed cap.
    expect(listByTenantMock.mock.calls.length).toBe(2);
    expect(listByTenantMock.mock.calls[0]).toEqual([TENANT, 500, 0]);
    expect(listByTenantMock.mock.calls[1]).toEqual([TENANT, 500, 500]);

    await app.close();
  });

  it("stops paging as soon as a short page comes back (exact multiple of the page size doesn't loop forever)", async () => {
    // Exactly 500 employees: one full page, then the loop must still issue a
    // second (empty) call to confirm there's no more -- and stop there, not
    // spin -- since a full-length page alone can't distinguish "exactly N"
    // from "at least N+1".
    const exact = Array.from({ length: 500 }, (_, i) => emp(i));
    listByTenantMock.mockImplementation(async (_tenantId: string, limit = 100, offset = 0) =>
      exact.slice(offset, offset + limit),
    );
    const app = await buildApp();
    const token = signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/internal/payroll-input?month=2026-07",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().employees.length).toBe(500);
    expect(listByTenantMock.mock.calls.length).toBe(2);
    expect(listByTenantMock.mock.calls[1]).toEqual([TENANT, 500, 500]);
    await app.close();
  });
});

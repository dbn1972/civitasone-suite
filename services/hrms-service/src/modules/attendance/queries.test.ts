/**
 * GAP-HR-ATTENDANCE-01: listAttendance used to show a raw 8-char uuid
 * fragment as "department" (attendance/queries.ts:51 `departmentId.slice(0,
 * 8)`) and hard-code hoursWorked to `undefined` even though inTime/outTime
 * are already loaded on every row.
 *
 * Pattern: mock ./repo.js (listByTenant), ../employee/repo.js (listByTenant,
 * findDepartmentsByIds) and ../../shared/infra.js (cache.listOrLoad bypasses
 * straight to the loader) -- no real DB, mirroring employee/queries.test.ts's
 * existing mocking convention in this service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoListByTenantMock = vi.fn();
vi.mock("./repo.js", () => ({
  listByTenant: (...args: unknown[]) => repoListByTenantMock(...args),
}));

const employeeListByTenantMock = vi.fn();
const findDepartmentsByIdsMock = vi.fn();
vi.mock("../employee/repo.js", () => ({
  listByTenant: (...args: unknown[]) => employeeListByTenantMock(...args),
  findDepartmentsByIds: (...args: unknown[]) => findDepartmentsByIdsMock(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    listOrLoad: (_tenantId: string, _resource: string, _hash: string, loader: () => unknown) => loader(),
  },
}));

import { listAttendance } from "./queries.js";

/** Every test here seeds exactly one attendance row; asserting the count
 *  keeps the non-null assertion below honest rather than just silencing
 *  TS's noUncheckedIndexedAccess. */
async function soleRow(tenantId: string, limit: number) {
  const rows = await listAttendance(tenantId, limit);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const TENANT = "aaaaaaaa-0001-4000-8000-000000000011";
const DEPT_ENGINEERING = "dept-eng-1";
const DEPT_FINANCE = "dept-fin-1";

const EMPLOYEES = [
  { id: "emp-1", fullName: "Asha Rao", departmentId: DEPT_ENGINEERING },
  { id: "emp-2", fullName: "Vikram Shah", departmentId: DEPT_FINANCE },
];

const DEPARTMENTS = [
  { id: DEPT_ENGINEERING, name: "Engineering" },
  { id: DEPT_FINANCE, name: "Finance" },
];

beforeEach(() => {
  repoListByTenantMock.mockReset();
  employeeListByTenantMock.mockReset();
  findDepartmentsByIdsMock.mockReset();
  employeeListByTenantMock.mockResolvedValue(EMPLOYEES);
  findDepartmentsByIdsMock.mockResolvedValue(DEPARTMENTS);
});

describe("listAttendance", () => {
  it("resolves the real department name instead of a uuid fragment", async () => {
    repoListByTenantMock.mockResolvedValue([
      { id: "att-1", employeeId: "emp-1", attendanceDate: "2026-09-01", status: "present", inTime: null, outTime: null },
    ]);

    const row = await soleRow(TENANT, 50);

    expect(row.department).toBe("Engineering");
    expect(row.department).not.toMatch(/^dept-/);
  });

  it("falls back to an empty string, not the raw id, when the department can't be resolved", async () => {
    findDepartmentsByIdsMock.mockResolvedValue([]); // department row missing/orphaned FK
    repoListByTenantMock.mockResolvedValue([
      { id: "att-1", employeeId: "emp-1", attendanceDate: "2026-09-01", status: "present", inTime: null, outTime: null },
    ]);

    const row = await soleRow(TENANT, 50);

    expect(row.department).toBe("");
  });

  it("computes hoursWorked from inTime/outTime, rounded to 2dp", async () => {
    repoListByTenantMock.mockResolvedValue([
      { id: "att-1", employeeId: "emp-1", attendanceDate: "2026-09-01", status: "present", inTime: "09:30:00", outTime: "18:00:00" },
    ]);

    const row = await soleRow(TENANT, 50);

    expect(row.hoursWorked).toBe(8.5);
  });

  it("returns hoursWorked undefined when there is no checkout", async () => {
    repoListByTenantMock.mockResolvedValue([
      { id: "att-1", employeeId: "emp-1", attendanceDate: "2026-09-01", status: "present", inTime: "09:30:00", outTime: null },
    ]);

    const row = await soleRow(TENANT, 50);

    expect(row.hoursWorked).toBeUndefined();
  });

  it("returns hoursWorked undefined when outTime is not after inTime (bad data, not an overnight shift)", async () => {
    repoListByTenantMock.mockResolvedValue([
      { id: "att-1", employeeId: "emp-1", attendanceDate: "2026-09-01", status: "present", inTime: "09:30:00", outTime: "09:30:00" },
    ]);

    const row = await soleRow(TENANT, 50);

    expect(row.hoursWorked).toBeUndefined();
  });
});

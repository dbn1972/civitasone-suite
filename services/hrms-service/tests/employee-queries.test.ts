/**
 * Employee queries unit tests — mock-based.
 *
 * HR-A deep-verify finding: getEmployeeDetail (modules/employee/queries.ts)
 * never populated `confirmationDate` or `reportingTo` on its response, even
 * though both are declared fields on the shared EmployeeDetailSchema
 * (packages/schemas/src/web.ts) and the EmployeeDetail type, both are backed
 * by real columns (confirmationDate already on the fetched row; reportingTo
 * resolved from managerId, settable via both employee edit forms), and both
 * are actively rendered by the frontend (a "Service Confirmed" lifecycle
 * event; a "Reports To" field) -- so neither could ever appear. These tests
 * cover the fix.
 *
 * SECURITY/COMPLIANCE finding: getEmployeeDetail returned emp.mobile raw
 * as phone, bypassing shared/pii-mask.ts's written policy that PII columns
 * (pan, aadhaarRef, bankAccountNo, bankIfsc, mobile) must never be returned
 * in full in any API response. This endpoint (GET /v1/hrms/employees/:id) is
 * reachable by every READER_ROLES member (hr_admin, hr_officer, super_admin,
 * manager) for any employee in the tenant. self-service/routes.ts already
 * masks mobile via maskPii() even for an employee viewing their OWN record,
 * so full masking here (last 4 digits only, matching maskValue's existing
 * convention) has no role carve-out anywhere else in this codebase. These
 * tests cover the fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const { findByIdMock, rowsMock, listByTenantMock, listByIdsMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  rowsMock: vi.fn(),
  listByTenantMock: vi.fn(async () => []),
  listByIdsMock: vi.fn(async () => []),
}));

// getEmployeeDetail resolves the main employee row (and, when managerId is
// set, the manager's row) through repo.findById -- mock that module boundary
// directly rather than the underlying db primitives.
vi.mock("../src/modules/employee/repo.js", () => ({
  listByTenant: (...a: unknown[]) => listByTenantMock(...a),
  // GAP-HR-SF-06: batch id lookup backing listEmployees' resolve(ids) path.
  listByIds: (...a: unknown[]) => listByIdsMock(...a),
  findById: (...a: unknown[]) => findByIdMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async (_key: string, fn: () => Promise<unknown>) => fn(),
    // GAP-HR-SF-06: listEmployees' browse/search path goes through
    // listOrLoad, not getOrLoad -- bypass caching the same way getOrLoad is
    // bypassed above so each test call re-runs its mocked repo call.
    listOrLoad: async (_tenantId: string, _resource: string, _key: string, fn: () => Promise<unknown>) => fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// Only the dept/desig lookups (getEmployeeDetail, always .limit(1)) and the
// dept-name-map lookup (listEmployees' browse/ids branches, no .limit() at
// all -- see queries.ts) go through scopedRead directly inside queries.ts;
// resolve them from a shared queue. The chain below is thenable at every
// step (not just after an explicit .limit()) so both call shapes resolve to
// the same queued rowsMock() value -- GAP-HR-SF-06's listEmployees tests are
// what first exercised the no-.limit() shape in this file.
vi.mock("../src/shared/db.js", () => {
  function chain(): any {
    return {
      limit: () => chain(),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rowsMock()).then(resolve, reject),
    };
  }
  return {
    scopedRead: async (fn: any) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => chain(),
          }),
        }),
      }),
  };
});

import { getEmployeeDetail, listEmployees } from "../src/modules/employee/queries.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    employeeNo: "EMP001",
    fullName: "Test Person",
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-01",
    status: "confirmed",
    managerId: null,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("getEmployeeDetail", () => {
  it("returns null when the employee row is not found", async () => {
    findByIdMock.mockResolvedValueOnce(null);
    const result = await getEmployeeDetail(randomUUID(), TENANT);
    expect(result).toBeNull();
  });

  it("includes confirmationDate when the row has one (regression: previously always omitted)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, confirmationDate: "2020-07-01" }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);       // dept
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]); // desig

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.confirmationDate).toBe("2020-07-01");
  });

  it("omits confirmationDate when the row has none (no regression)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, confirmationDate: null }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.confirmationDate).toBeUndefined();
  });

  it("resolves reportingTo to the manager's name when managerId is set (regression: previously always omitted)", async () => {
    const id = randomUUID();
    const managerId = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, managerId }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);
    findByIdMock.mockResolvedValueOnce({ id: managerId, fullName: "Manager Name" });

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.reportingTo).toBe("Manager Name");
    expect(findByIdMock).toHaveBeenCalledWith(managerId, TENANT);
    expect(findByIdMock).toHaveBeenCalledTimes(2);
  });

  it("omits reportingTo and does not look up a manager when managerId is null (no regression)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, managerId: null }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.reportingTo).toBeUndefined();
    expect(findByIdMock).toHaveBeenCalledTimes(1);
  });

  it("SECURITY: masks the mobile number to last 4 digits in phone -- never returns it in full (regression: previously raw)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, mobile: "9876543210" }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.phone).toBe("******3210");
    expect(result?.phone).not.toBe("9876543210");
    expect(result?.phone).not.toContain("987654");
  });

  it("omits phone when the row has no mobile number (no regression)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, mobile: null }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.phone).toBeUndefined();
  });

  it("includes payStructureId when the row has one (GAP-HR-EMPLOYEES-DETAIL-EDIT-04: previously always omitted, so the pay-structure picker started blank on every visit)", async () => {
    const id = randomUUID();
    const payStructureId = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, payStructureId }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.payStructureId).toBe(payStructureId);
  });

  it("omits payStructureId when the row has none (no regression)", async () => {
    const id = randomUUID();
    findByIdMock.mockResolvedValueOnce(baseRow({ id, payStructureId: null }));
    rowsMock.mockResolvedValueOnce([{ name: "Finance" }]);
    rowsMock.mockResolvedValueOnce([{ name: "Officer", payGrade: null }]);

    const result = await getEmployeeDetail(id, TENANT);
    expect(result?.payStructureId).toBeUndefined();
  });
});

describe("listEmployees — GAP-HR-SF-06 (EntityPicker) q/ids", () => {
  it("passes q through to repo.listByTenant (the browse/search path)", async () => {
    listByTenantMock.mockResolvedValueOnce([]);
    rowsMock.mockResolvedValueOnce([]); // departments
    rowsMock.mockResolvedValueOnce([]); // designations (#1686)
    await listEmployees(TENANT, 20, 0, undefined, undefined, "Asha");
    // #1759 added a trailing `status` filter argument to repo.listByTenant.
    expect(listByTenantMock).toHaveBeenCalledWith(TENANT, 20, 0, undefined, undefined, "Asha", undefined);
  });

  it("ids takes the batch-lookup path (repo.listByIds), bypassing repo.listByTenant entirely", async () => {
    const row = {
      id: "e1",
      employeeNo: "EMP001",
      fullName: "Asha Rao",
      departmentId: "d1",
      designationId: "g1",
      employeeType: "permanent",
      status: "active",
      dateOfJoining: "2020-01-01",
    };
    listByIdsMock.mockResolvedValueOnce([row]);
    rowsMock.mockResolvedValueOnce([{ id: "d1", name: "Finance" }]);
    // #1686: the ids path also resolves designation name + pay grade.
    rowsMock.mockResolvedValueOnce([{ id: "g1", name: "Officer", payGrade: "L10" }]);

    const result = await listEmployees(TENANT, 20, 0, undefined, undefined, undefined, ["e1"]);

    expect(listByIdsMock).toHaveBeenCalledWith(TENANT, ["e1"], undefined);
    expect(listByTenantMock).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      {
        id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", employeeType: "permanent", status: "active",
        // GAP-HR-DASHBOARD-04 (#1702): dateOfJoining is always present;
        // GAP-HR-EMPLOYEES directory (#1686): designation/grade when resolvable.
        dateOfJoining: "2020-01-01", designation: "Officer", grade: "L10",
      },
    ]);
  });

  it("ids path still fails closed to an empty list when managerScope is null (manager-only caller with no resolvable link)", async () => {
    const result = await listEmployees(TENANT, 20, 0, undefined, null, undefined, ["e1"]);
    expect(result).toEqual({ data: [], pagination: { hasMore: false, pageSize: 20 } });
    expect(listByIdsMock).not.toHaveBeenCalled();
  });

  it("ids path forwards managerScope to repo.listByIds so a manager-only caller can only resolve their own direct reports", async () => {
    listByIdsMock.mockResolvedValueOnce([]);
    rowsMock.mockResolvedValueOnce([]); // departments
    rowsMock.mockResolvedValueOnce([]); // designations (#1686)
    await listEmployees(TENANT, 20, 0, undefined, "manager-emp-id", undefined, ["e1"]);
    expect(listByIdsMock).toHaveBeenCalledWith(TENANT, ["e1"], "manager-emp-id");
  });
});

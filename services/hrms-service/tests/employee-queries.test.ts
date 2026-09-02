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

const { findByIdMock, rowsMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  rowsMock: vi.fn(),
}));

// getEmployeeDetail resolves the main employee row (and, when managerId is
// set, the manager's row) through repo.findById -- mock that module boundary
// directly rather than the underlying db primitives.
vi.mock("../src/modules/employee/repo.js", () => ({
  findById: (...a: unknown[]) => findByIdMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async (_key: string, fn: () => Promise<unknown>) => fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// Only the dept and desig lookups go through scopedRead directly inside
// queries.ts (in that fixed order); resolve them from a shared queue.
vi.mock("../src/shared/db.js", () => ({
  scopedRead: async (fn: any) =>
    fn({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rowsMock(),
          }),
        }),
      }),
    }),
}));

import { getEmployeeDetail } from "../src/modules/employee/queries.js";

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
});

/**
 * getEmployeeDetail — statutory identifiers (HRMS role-based review, finding 3)
 *
 * uanNumber/esicIpNumber/pran are real columns on the employee row (already
 * loaded by repo.findById's unrestricted `select()`) and are deliberately
 * absent from pii-mask.ts's PII_FIELDS list -- but getEmployeeDetail never
 * added them to its returned shape at all, so EditEmployeeForm.tsx always
 * saw them as undefined regardless of what was on file. This covers:
 *  - present on the row -> present, unmasked, in the returned shape
 *  - absent on the row -> omitted (not a masked placeholder) from the shape
 *  - contrast with pan, which IS masked (confirms the "no masking here" call
 *    in the fix's own comment is actually exercised, not just asserted)
 *
 * Pattern: mock ./repo.js (findById), ../../shared/infra.js (cache.getOrLoad
 * bypasses straight to the loader), and ../../shared/db.js (scopedRead) --
 * no real DB. managerId is left unset on the fixture so getEmployeeDetail's
 * second repo.findById call (manager lookup) is never reached, keeping the
 * mock focused on what this test actually cares about.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findByIdMock = vi.fn();
vi.mock("./repo.js", () => ({ findById: (...args: unknown[]) => findByIdMock(...args) }));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// getEmployeeDetail's department/designation lookups both resolve to their
// "—" / omitted fallback when scopedRead returns no rows -- irrelevant to
// what this test asserts, so one generic empty-result mock covers both.
vi.mock("../../shared/db.js", () => ({
  scopedRead: (fn: (tx: unknown) => unknown) => {
    const empty = { then: (res: (v: unknown[]) => unknown) => Promise.resolve(res([])) };
    // getEmployeeDetail's dept/designation lookups both chain
    // .select().from().where().limit(1) -- .where() must itself yield
    // something with a .limit() (which resolves to the empty fallback), not
    // just a bare thenable, or the real chain 4 levels deep throws.
    const tx = { select: () => ({ from: () => ({ ...empty, where: () => ({ ...empty, limit: () => empty }) }) }) };
    return Promise.resolve(fn(tx));
  },
}));

import { getEmployeeDetail } from "./queries.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000011";

const BASE_EMPLOYEE = {
  id: "emp-1",
  tenantId: TENANT,
  employeeNo: "E001",
  fullName: "Test Employee",
  departmentId: "dept-1",
  designationId: "desig-1",
  dateOfJoining: "2020-01-01",
  status: "confirmed",
  email: null,
  mobile: null,
  bankAccountNo: null,
  bankIfsc: null,
  pan: null,
  station: null,
  confirmationDate: null,
  managerId: null,
  uanNumber: null,
  esicIpNumber: null,
  pran: null,
};

beforeEach(() => {
  findByIdMock.mockReset();
});

describe("getEmployeeDetail — statutory identifiers (UAN / ESIC IP / PRAN)", () => {
  it("includes uanNumber, esicIpNumber, and pran when present on the row", async () => {
    findByIdMock.mockResolvedValue({
      ...BASE_EMPLOYEE,
      uanNumber: "100123456789",
      esicIpNumber: "3100123456000123",
      pran: "110012345678",
    });

    const detail = await getEmployeeDetail("emp-1", TENANT);

    expect(detail?.uanNumber).toBe("100123456789");
    expect(detail?.esicIpNumber).toBe("3100123456000123");
    expect(detail?.pran).toBe("110012345678");
  });

  it("omits the fields (not a masked placeholder) when not on file", async () => {
    findByIdMock.mockResolvedValue({ ...BASE_EMPLOYEE });

    const detail = await getEmployeeDetail("emp-1", TENANT);

    expect(detail?.uanNumber).toBeUndefined();
    expect(detail?.esicIpNumber).toBeUndefined();
    expect(detail?.pran).toBeUndefined();
    expect(detail && "uanNumber" in detail).toBe(false);
  });

  it("does not mask uanNumber/esicIpNumber/pran, unlike pan (which pii-mask.ts does mask)", async () => {
    findByIdMock.mockResolvedValue({
      ...BASE_EMPLOYEE,
      pan: "ABCDE1234F",
      uanNumber: "100123456789",
    });

    const detail = await getEmployeeDetail("emp-1", TENANT);

    expect(detail?.pan).toBe("******234F"); // maskValue: all but last 4 chars
    expect(detail?.uanNumber).toBe("100123456789"); // full value -- not in PII_FIELDS
  });
});

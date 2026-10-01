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
const listByTenantMock = vi.fn();
const listByIdsMock = vi.fn();
vi.mock("./repo.js", () => ({
  findById: (...args: unknown[]) => findByIdMock(...args),
  listByTenant: (...args: unknown[]) => listByTenantMock(...args),
  listByIds: (...args: unknown[]) => listByIdsMock(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    // GAP-HR-DIRECTORY-01: listEmployees's non-`ids` path goes through
    // cache.listOrLoad, not getOrLoad -- bypass straight to the loader, same
    // as getOrLoad above, so these tests exercise real query-building logic
    // without a cache dependency.
    listOrLoad: (_tenantId: string, _kind: string, _key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// Fixture rows for the department/designation lookup tables, keyed by which
// Drizzle table object `.from(...)` was called with -- `vi.hoisted` so the
// mock factory below (hoisted above these `const`s) and each `it()` block
// (which mutates them) share the same object.
const dbFixtures = vi.hoisted(() => ({
  departmentRows: [] as unknown[],
  designationRows: [] as unknown[],
}));

// getEmployeeDetail's department/designation lookups chain
// .select().from(table).where(...).limit(1); listEmployees's chain
// .select().from(table).where(...) with no .limit(). One chainable stub
// covers both shapes and both tables: it inspects which schema object
// `.from()` was called with and resolves to that table's current fixture
// rows (empty by default, i.e. today's existing getEmployeeDetail tests'
// "-- / omitted" behavior, unless a test opts in via dbFixtures above).
vi.mock("../../shared/db.js", async () => {
  const schema = await import("./schema.js");
  function chain(rows: unknown[]): any {
    return {
      where: () => chain(rows),
      limit: () => chain(rows),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
  }
  return {
    scopedRead: (fn: (tx: unknown) => unknown) => {
      const tx = {
        select: () => ({
          from: (table: unknown) => {
            if (table === schema.hrmsDepartments) return chain(dbFixtures.departmentRows);
            if (table === schema.hrmsDesignations) return chain(dbFixtures.designationRows);
            return chain([]);
          },
        }),
      };
      return Promise.resolve(fn(tx));
    },
  };
});

import { getEmployeeDetail, listEmployees } from "./queries.js";

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
  listByTenantMock.mockReset();
  listByIdsMock.mockReset();
  dbFixtures.departmentRows = [];
  dbFixtures.designationRows = [];
});

// GAP-HR-DIRECTORY-01: designation/grade were promised by the directory UI
// (and its own i18n subtitle) but listEmployees never resolved them, so
// every card's designation line rendered blank (or the literal "undefined"
// once concatenated into an aria-label -- GAP-HR-DIRECTORY-02) and the
// Designations stat card always read 0. GAP-HR-DIRECTORY-04: `email` is
// added at the same time (a non-masked column, per the published decision
// packet's default -- work email only, never mobile/PAN/bank).
describe("listEmployees — designation/grade/email (GAP-HR-DIRECTORY-01/04)", () => {
  const ROW = {
    id: "emp-1",
    employeeNo: "E001",
    fullName: "Asha Rao",
    departmentId: "dept-1",
    designationId: "desig-1",
    employeeType: "permanent",
    status: "confirmed",
    email: "asha.rao@example.gov.in",
    dateOfJoining: "2021-06-15",
  };

  it("includes designation, grade, email, and dateOfJoining for a seeded employee with a designation", async () => {
    listByTenantMock.mockResolvedValue([ROW]);
    dbFixtures.departmentRows = [{ id: "dept-1", name: "Finance" }];
    dbFixtures.designationRows = [{ id: "desig-1", name: "Under Secretary", payGrade: "Grade-3" }];

    const result = await listEmployees(TENANT, 200, 0);

    expect(result.data).toEqual([
      {
        id: "emp-1",
        employeeNo: "E001",
        name: "Asha Rao",
        department: "Finance",
        employeeType: "permanent",
        status: "confirmed",
        designation: "Under Secretary",
        grade: "Grade-3",
        email: "asha.rao@example.gov.in",
        dateOfJoining: "2021-06-15",
      },
    ]);
  });

  it("omits designation/grade/email (not a placeholder) when unresolvable or absent", async () => {
    listByTenantMock.mockResolvedValue([{ ...ROW, email: null }]);
    dbFixtures.departmentRows = [{ id: "dept-1", name: "Finance" }];
    dbFixtures.designationRows = []; // no matching designation row

    const result = await listEmployees(TENANT, 200, 0);

    expect(result.data[0]?.designation).toBeUndefined();
    expect(result.data[0]?.grade).toBeUndefined();
    expect(result.data[0]?.email).toBeUndefined();
    expect(result.data[0] && "location" in result.data[0]).toBe(false);
    expect(result.data[0] && "extension" in result.data[0]).toBe(false);
  });

  it("never includes mobile, PAN, or bank fields regardless of what repo.listByTenant returns", async () => {
    // repo.listByTenant's real row shape (EmployeeRow) does carry these
    // columns -- this asserts listEmployees's own mapping never spreads the
    // raw row, so a future change to that mapping can't accidentally widen
    // the directory response to leak them (GAP-HR-DIRECTORY-04's decision).
    listByTenantMock.mockResolvedValue([{ ...ROW, mobile: "9876543210", pan: "ABCDE1234F", bankAccountNo: "1234567890" }]);
    dbFixtures.departmentRows = [{ id: "dept-1", name: "Finance" }];
    dbFixtures.designationRows = [{ id: "desig-1", name: "Under Secretary", payGrade: "Grade-3" }];

    const result = await listEmployees(TENANT, 200, 0);

    const row = result.data[0] as Record<string, unknown>;
    expect(row.mobile).toBeUndefined();
    expect(row.pan).toBeUndefined();
    expect(row.bankAccountNo).toBeUndefined();
  });
});

// GAP-HR-DASHBOARD-04: dateOfJoining is a real, NOT NULL column
// (hrms_employees.date_of_joining) -- unlike designation/grade/email above,
// it must always be present, never conditionally omitted. Covers both
// listEmployees branches (repo.listByTenant's cached tenant-list path and
// repo.listByIds' uncached ids= path), since both map rows independently.
describe("listEmployees — dateOfJoining (GAP-HR-DASHBOARD-04)", () => {
  it("includes dateOfJoining in the default tenant-list branch", async () => {
    listByTenantMock.mockResolvedValue([{
      id: "emp-2", employeeNo: "E002", fullName: "Kiran Kumar", departmentId: "dept-1",
      designationId: "desig-1", employeeType: "permanent", status: "confirmed", email: null,
      dateOfJoining: "2019-11-02",
    }]);
    dbFixtures.departmentRows = [{ id: "dept-1", name: "Finance" }];
    dbFixtures.designationRows = [];

    const result = await listEmployees(TENANT, 200, 0);

    expect(result.data[0]?.dateOfJoining).toBe("2019-11-02");
  });

  it("includes dateOfJoining in the ids= batch-lookup branch", async () => {
    listByIdsMock.mockResolvedValue([{
      id: "emp-3", employeeNo: "E003", fullName: "Priya Singh", departmentId: "dept-1",
      designationId: "desig-1", employeeType: "permanent", status: "confirmed", email: null,
      dateOfJoining: "2022-03-20",
    }]);
    dbFixtures.departmentRows = [{ id: "dept-1", name: "Finance" }];
    dbFixtures.designationRows = [];

    const result = await listEmployees(TENANT, 200, 0, undefined, undefined, undefined, ["emp-3"]);

    expect(result.data[0]?.dateOfJoining).toBe("2022-03-20");
  });
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

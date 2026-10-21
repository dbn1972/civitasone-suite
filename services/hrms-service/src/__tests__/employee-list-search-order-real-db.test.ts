/**
 * GET /v1/hrms/employees -- search, status filter, designation, ordering and
 * total, against a real database (RLS FORCEd on the employee tables).
 *
 *  - GAP-HR-EMPLOYEES-NEW-04: ?status=confirmed&q=sharma returns only the
 *    matching, confirmed employees and carries each one's designation; a tenant
 *    with hundreds of people can still find employee #250 / #513 by typing.
 *  - GAP-HR-LEAVE-ALLOCATE-04: results are ordered by name (so a picker lists
 *    them alphabetically and a page never repeats/skips a row) and the response
 *    carries the real `total`, not just hasMore.
 *  - GAP-HR-EMPLOYEES-NEW-02: GET /:id returns basicMinor to HR roles and to
 *    nobody else (manager reading a direct report, employee reading themself).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";

const TENANT = "facade00-0902-4000-8000-000000000902";
const OTHER_TENANT = "facade00-0902-4000-8000-000000000903";
const SEED = "facade00-0902-4000-8000-000000000099";
const DEPT = "facade00-0902-4000-8000-0000000000d1";
const DESIG_US = "facade00-0902-4000-8000-0000000000d2";
const DESIG_SO = "facade00-0902-4000-8000-0000000000d3";
const OTHER_DEPT = "facade00-0902-4000-8000-0000000000d4";
const OTHER_DESIG = "facade00-0902-4000-8000-0000000000d5";
const MANAGER = "facade00-0902-4000-8000-0000000000e1";
const REPORT = "facade00-0902-4000-8000-0000000000e2";
const MANAGER_SUB = "mgr-facade-902";

const tok = (roles: string[], sub = "hr-facade-902") =>
  `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-list-search-902" }, SECRET)}`;
const hr = { authorization: tok(["hr_admin"]) };

const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
const asOther = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, OTHER_TENANT, fn);

async function cleanup(): Promise<void> {
  for (const run of [asTenant, asOther]) {
    await run((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`);
    await run((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`);
    await run((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`);
  }
}

let app: Awaited<ReturnType<typeof buildApp>>;

type ListBody = {
  data: { id: string; employeeNo: string; name: string; designation?: string; status: string }[];
  pagination: { total?: number; hasMore: boolean; pageSize: number };
};
const list = async (qs: string, headers: Record<string, string> = hr) => {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/employees?${qs}`, headers });
  return { status: r.statusCode, body: r.json<ListBody>() };
};

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'LS', 'Search Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_US}, ${TENANT}, 'US', 'Under Secretary', ${SEED}, ${SEED}), (${DESIG_SO}, ${TENANT}, 'SO', 'Section Officer', ${SEED}, ${SEED})`);
  // The named people the search assertions are about.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, basic_minor, created_by, updated_by)
    VALUES
      ('facade00-0902-4000-8000-0000000001a1', ${TENANT}, 'S-001', 'Zoya Sharma',  ${DEPT}, ${DESIG_US}, '2020-01-01', 'confirmed', 0, ${SEED}, ${SEED}),
      ('facade00-0902-4000-8000-0000000001a2', ${TENANT}, 'S-002', 'asha sharma',  ${DEPT}, ${DESIG_SO}, '2020-01-01', 'confirmed', 0, ${SEED}, ${SEED}),
      ('facade00-0902-4000-8000-0000000001a3', ${TENANT}, 'S-003', 'Rohit Sharma', ${DEPT}, ${DESIG_SO}, '2020-01-01', 'separated', 0, ${SEED}, ${SEED}),
      ('facade00-0902-4000-8000-0000000001a4', ${TENANT}, 'S-004', 'Priya Verma',  ${DEPT}, ${DESIG_SO}, '2020-01-01', 'confirmed', 0, ${SEED}, ${SEED})`);
  // 520 filler people: more than one 500-row page and more than the 200/250
  // the old pickers silently stopped at.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, created_by, updated_by)
    SELECT ${TENANT}, 'P' || lpad(n::text, 4, '0'), 'Person ' || lpad(n::text, 4, '0'), ${DEPT}, ${DESIG_SO}, '2021-01-01', 'confirmed', ${SEED}, ${SEED}
    FROM generate_series(1, 520) AS n`);
  // A manager with one direct report (for the pay-visibility assertions) + a pay figure.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, basic_minor, created_by, updated_by)
    VALUES (${MANAGER}, ${TENANT}, 'M-001', 'Mina Manager', ${DEPT}, ${DESIG_US}, '2015-01-01', 'confirmed', ${MANAGER_SUB}, 9000000, ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, manager_id, basic_minor, created_by, updated_by)
    VALUES (${REPORT}, ${TENANT}, 'R-001', 'Ravi Report', ${DEPT}, ${DESIG_SO}, '2018-01-01', 'confirmed', ${MANAGER}, 4490050, ${SEED}, ${SEED})`);
  // Another tenant with a Sharma of its own: must never show up for TENANT.
  await asOther((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${OTHER_DEPT}, ${OTHER_TENANT}, 'LS', 'Other Dept', ${SEED}, ${SEED})`);
  await asOther((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${OTHER_DESIG}, ${OTHER_TENANT}, 'X', 'Other Desig', ${SEED}, ${SEED})`);
  await asOther((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, created_by, updated_by)
    VALUES ('facade00-0902-4000-8000-0000000002a1', ${OTHER_TENANT}, 'O-001', 'Other Tenant Sharma', ${OTHER_DEPT}, ${OTHER_DESIG}, '2020-01-01', 'confirmed', ${SEED}, ${SEED})`);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("GET /v1/hrms/employees?status=&q= (GAP-HR-EMPLOYEES-NEW-04)", () => {
  it("returns only the confirmed people matching 'sharma', each with its designation, and none from another tenant or status", async () => {
    const { status, body } = await list("status=confirmed&q=sharma&limit=20");
    expect(status).toBe(200);
    expect(body.data.map((e) => e.name)).toEqual(["asha sharma", "Zoya Sharma"]);
    expect(body.data.map((e) => e.designation)).toEqual(["Section Officer", "Under Secretary"]);
    expect(body.data.every((e) => e.status === "confirmed")).toBe(true);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("matches on employee number too", async () => {
    const { body } = await list("q=S-004&limit=20");
    expect(body.data.map((e) => e.name)).toEqual(["Priya Verma"]);
  });

  it("finds an employee deep in a large tenant by typing (employee 513 of 520 fillers)", async () => {
    const { body } = await list("q=Person%200513&limit=20");
    expect(body.data.map((e) => e.employeeNo)).toEqual(["P0513"]);
    expect(body.pagination.total).toBe(1);
  });
});

describe("GET /v1/hrms/employees ordering and total (GAP-HR-LEAVE-ALLOCATE-04)", () => {
  it("orders by name regardless of letter case, then employee number", async () => {
    const { body } = await list("q=sharma&limit=20");
    // lower(name): asha sharma < rohit sharma < zoya sharma
    expect(body.data.map((e) => e.name)).toEqual(["asha sharma", "Rohit Sharma", "Zoya Sharma"]);
  });

  it("returns the real total (not the page size) and an exact hasMore", async () => {
    const first = await list("q=Person&limit=20&offset=0");
    expect(first.body.data).toHaveLength(20);
    expect(first.body.pagination.total).toBe(520);
    expect(first.body.pagination.hasMore).toBe(true);
    // Last page: 520 = 26 * 20, so the 26th page ends exactly on the boundary.
    const last = await list("q=Person&limit=20&offset=500");
    expect(last.body.data).toHaveLength(20);
    expect(last.body.pagination.total).toBe(520);
    expect(last.body.pagination.hasMore).toBe(false);
  });

  it("pages are stable: consecutive pages neither repeat nor skip a row", async () => {
    const a = await list("q=Person&limit=20&offset=0");
    const b = await list("q=Person&limit=20&offset=20");
    const names = [...a.body.data, ...b.body.data].map((e) => e.name);
    expect(names).toEqual(Array.from({ length: 40 }, (_, i) => `Person ${String(i + 1).padStart(4, "0")}`));
  });

  it("an employee beyond position 500 is reachable by paging, with no 500-row ceiling", async () => {
    const { body } = await list("q=Person&limit=20&offset=510");
    expect(body.data.map((e) => e.employeeNo)).toContain("P0520");
  });
});

describe("GET /v1/hrms/employees/:id basic pay visibility (GAP-HR-EMPLOYEES-NEW-02)", () => {
  const get = (id: string, authorization: string) => app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: { authorization } });

  it("HR sees basicMinor in paise", async () => {
    const r = await get(REPORT, tok(["hr_officer"]));
    expect(r.statusCode).toBe(200);
    expect(r.json<{ basicMinor?: number }>().basicMinor).toBe(4490050);
  });

  it("a manager reading a direct report does NOT get the pay field", async () => {
    const r = await get(REPORT, tok(["manager"], MANAGER_SUB));
    expect(r.statusCode).toBe(200);
    expect(r.json()).not.toHaveProperty("basicMinor");
  });

  it("an employee reading their own record does NOT get the pay field", async () => {
    const r = await get(MANAGER, tok(["employee"], MANAGER_SUB));
    expect(r.statusCode).toBe(200);
    expect(r.json()).not.toHaveProperty("basicMinor");
  });
});

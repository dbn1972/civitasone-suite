/**
 * Service book read-scope regression test — real-DB round-trip
 * (GAP-HR-SERVICE-BOOK-01/06).
 *
 * SEC finding (GAP-HR-SERVICE-BOOK-01): the printable/PDF route
 * (GET /v1/hrms/employees/:id/service-book/pdf) had NO employee scoping at
 * all -- any READER_ROLES-holding caller, including "manager", could pull
 * ANY employee's document just by id, unlike the sibling JSON route
 * (GET /v1/hrms/employees/:id/service-book), which already restricted a
 * manager-only caller to their own department. Both routes now share one
 * assertCanReadEmployee() helper (routes.ts) so they cannot drift again.
 *
 * GAP-HR-SERVICE-BOOK-06: employees could not read even their OWN service
 * book before this fix (HR/manager only). GET /v1/hrms/service-book/me is
 * new, resolving the caller's own record server-side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT      = "facade00-0f1b-4000-8000-000000000f1b";
const SEED_ACTOR   = "facade00-0f1b-4000-8000-0000000000ff";
const DEPT_A       = "facade00-0f1b-4000-8000-0000000000d1";
const DEPT_B       = "facade00-0f1b-4000-8000-0000000000d2";
const DESIG_ID     = "facade00-0f1b-4000-8000-0000000000d9";

const MANAGER_ID   = "facade00-0f1b-4000-8000-0000000000e1"; // dept A
const REPORT_ID    = "facade00-0f1b-4000-8000-0000000000e2"; // dept A, manager's report
const OUTSIDER_ID  = "facade00-0f1b-4000-8000-0000000000e3"; // dept B, NOT a report

const MANAGER_SUB  = "sb-scope-mgr-f1b";
const REPORT_SUB   = "sb-scope-report-f1b";
const OUTSIDER_SUB = "sb-scope-outsider-f1b";
const HR_SUB       = "sb-scope-hr-f1b";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-sb-scope-test" }, SECRET);
}
const managerToken = tok(["manager"], MANAGER_SUB);
const reportToken  = tok(["employee"], REPORT_SUB);
const hrToken      = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_service_book_entries WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_A}, ${TENANT}, 'SBSCA', 'Service Book Scope Test Dept A', ${SEED_ACTOR}, ${SEED_ACTOR}),
           (${DEPT_B}, ${TENANT}, 'SBSCB', 'Service Book Scope Test Dept B', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'SBSC', 'Service Book Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${MANAGER_ID}, ${TENANT}, 'SBSC-001', 'Service Book Scope Manager', ${DEPT_A}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
    VALUES (${REPORT_ID}, ${TENANT}, 'SBSC-002', 'Service Book Scope Report', ${DEPT_A}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${REPORT_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${OUTSIDER_ID}, ${TENANT}, 'SBSC-003', 'Service Book Scope Outsider', ${DEPT_B}, ${DESIG_ID}, '2019-01-01', ${OUTSIDER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const [empId, label] of [[REPORT_ID, "report"], [OUTSIDER_ID, "outsider"]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_service_book_entries
        (id, tenant_id, employee_id, entry_type, effective_date, description, recorded_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, 'join', '2020-01-01', ${`Joined as ${label}`}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/employees/:id/service-book/pdf — dept scoping (GAP-HR-SERVICE-BOOK-01)", () => {
  it("a manager may print their own direct report's service book", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${REPORT_ID}/service-book/pdf`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Joined as report");
  });

  it("a manager may NOT print an outsider's (different-department) service book -- the gap this fix closes", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${OUTSIDER_ID}/service-book/pdf`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("HR may print any employee's service book, unrestricted", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${OUTSIDER_ID}/service-book/pdf`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Joined as outsider");
  });

  // GAP-HR-SERVICE-BOOK-06 side effect: assertCanReadEmployee's "employee:
  // own record only" branch also covers this older per-id route, not just
  // the new /me endpoint -- a bare employee requesting their OWN id here
  // now works too, which is a strict widening (previously 403 for every
  // non-HR/manager caller) never a narrowing.
  it("a bare employee may print their OWN document via this route", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${REPORT_ID}/service-book/pdf`,
      headers: { authorization: `Bearer ${reportToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Joined as report");
  });

  it("a bare employee may NOT print a DIFFERENT employee's document via this route", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${OUTSIDER_ID}/service-book/pdf`,
      headers: { authorization: `Bearer ${reportToken}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/service-book/me — self-service (GAP-HR-SERVICE-BOOK-06)", () => {
  it("returns exactly the caller's own entries", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/service-book/me",
      headers: { authorization: `Bearer ${reportToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ description: string }>;
    expect(rows.map((x) => x.description)).toEqual(["Joined as report"]);
  });

  it("a caller with no linked employee record gets an empty list, not an error", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/service-book/me",
      headers: { authorization: `Bearer ${tok(["employee"], "sb-scope-unlinked-f1b")}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data).toEqual([]);
  });
});

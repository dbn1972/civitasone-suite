/**
 * GAP-HR-LEAVE-HISTORY-01 — real-DB round-trip regression test.
 *
 * GET /v1/hrms/leave/applications?empId=...&limit=&offset= used to (a) never
 * actually pass limit/offset through to the DB query at all (repo.
 * findLeaveAppsByEmp always fetched its own default-100, unordered), and
 * (b) report `meta.total = data.length` -- the length of whatever page it
 * happened to fetch, not a real count. This suite seeds one employee with
 * MORE applications than a single small page, and proves: real limit/offset
 * pagination, newest-first deterministic ordering, a real `meta.total`
 * (independent of page size), and a real `meta.statusCounts` aggregate over
 * the FULL set (not just the page).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a157-4000-8000-000000000a54";
const SEED_ACTOR = "facade00-a157-4000-8000-0000000000ff";
const DEPT_ID = "facade00-a157-4000-8000-0000000000d1";
const DESIG_ID = "facade00-a157-4000-8000-0000000000d2";
const LEAVE_TYPE_ID = "facade00-a157-4000-8000-0000000000ca";
const EMP_ID = "facade00-a157-4000-8000-0000000000e1";
const ALLOC_ID = "facade00-a157-4000-8000-0000000000a1";

// 7 applications: index 0 is the OLDEST, index 6 the NEWEST (createdAt
// staggered one second apart so `ORDER BY created_at DESC` is unambiguous
// regardless of how fast the seeding transaction itself runs).
const APPS = [
  { idx: 0, status: "rejected" },
  { idx: 1, status: "cancelled" },
  { idx: 2, status: "approved" },
  { idx: 3, status: "pending" },
  { idx: 4, status: "approved" },
  { idx: 5, status: "pending" },
  { idx: 6, status: "approved" }, // newest
].map((a) => ({ ...a, id: `facade00-a157-4000-8000-0000000b00${String(a.idx).padStart(2, "0")}` }));

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-history-pagination-test" }, SECRET);
}
const hrToken = tok(["hr_admin"], "facade00-a157-4000-8000-0000000000a9");

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'HP01', 'History Pagination Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'HP01', 'History Pagination Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by) VALUES (${EMP_ID}, ${TENANT}, 'HP01-001', 'History Pagination Employee', ${DEPT_ID}, ${DESIG_ID}, '2018-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'HP01', 'History Pagination Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${ALLOC_ID}, ${TENANT}, ${EMP_ID}, ${LEAVE_TYPE_ID}, '2026-27', 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const a of APPS) {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, a.idx)).toISOString();
    // Distinct, non-overlapping dates per row: a real employee's applications
    // never share identical from/to dates, and `ux_leave_apps_active` (a
    // pre-existing partial unique index guarding against duplicate/
    // overlapping active leave) would reject more than one active-status row
    // for the same employee+type+date range.
    const day = String(a.idx + 1).padStart(2, "0");
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_apps
        (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_at, updated_at, created_by, updated_by)
      VALUES
        (${a.id}, ${TENANT}, ${EMP_ID}, ${LEAVE_TYPE_ID}, ${ALLOC_ID}, ${`2026-11-${day}`}, ${`2026-11-${day}`}, 1, ${a.status}, ${createdAt}, ${createdAt}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/leave/applications — pagination, total, statusCounts (GAP-HR-LEAVE-HISTORY-01)", () => {
  it("first page (limit=3, offset=0): the 3 NEWEST applications, newest first", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/leave/applications?empId=${EMP_ID}&limit=3&offset=0`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string }>; meta: { total: number; statusCounts?: Record<string, number> } };
    expect(body.data.map((d) => d.id)).toEqual([APPS[6]!.id, APPS[5]!.id, APPS[4]!.id]);
    // The real total across ALL 7 seeded rows, not this page's length (3).
    expect(body.meta.total).toBe(7);
  });

  it("second page (limit=3, offset=3): the next 3, still newest-first, same real total", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/leave/applications?empId=${EMP_ID}&limit=3&offset=3`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string }>; meta: { total: number } };
    expect(body.data.map((d) => d.id)).toEqual([APPS[3]!.id, APPS[2]!.id, APPS[1]!.id]);
    expect(body.meta.total).toBe(7);
  });

  it("meta.statusCounts reflects the FULL set, not just the current page", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/leave/applications?empId=${EMP_ID}&limit=2&offset=0`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { meta: { statusCounts: Record<string, number> } };
    expect(body.meta.statusCounts).toEqual({ approved: 3, pending: 2, rejected: 1, cancelled: 1 });
  });
});

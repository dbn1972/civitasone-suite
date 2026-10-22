/**
 * GET /v1/hrms/leave-requests -- name resolution at scale, and the opt-in page
 * envelope (GAP-HR-LEAVE-03), against a real database.
 *
 *  - A request from employee #550 of 600 shows that employee's REAL name. The
 *    list used to resolve names from the tenant's first 500 employees and fall
 *    back to an id fragment for anyone past that.
 *  - ?withMeta=1 returns `{ data, meta }` with the real total, per-status counts
 *    over the caller's WHOLE visible set (not the page), and an exact hasMore;
 *    a manager's counts/total are scoped to their direct reports.
 *  - Without withMeta the response is still the bare array every existing caller
 *    parses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";

const TENANT = "facade00-0f17-4000-8000-000000000f17";
const SEED = "facade00-0f17-4000-8000-0000000000ff";
const DEPT = "facade00-0f17-4000-8000-0000000000d1";
const DESIG = "facade00-0f17-4000-8000-0000000000d2";
const LEAVE_TYPE = "facade00-0f17-4000-8000-0000000000ca";
const MANAGER = "facade00-0f17-4000-8000-0000000000e1";
const REPORT = "facade00-0f17-4000-8000-0000000000e2";
const MANAGER_SUB = "leave-page-mgr-f17";

const tok = (roles: string[], sub = "leave-page-hr-f17") =>
  `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-leave-page-test" }, SECRET)}`;
const hr = { authorization: tok(["hr_admin"]) };

const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

let app: Awaited<ReturnType<typeof buildApp>>;
let emp550Id = "";

type Req = { id: string; employeeName: string; status: string };
type Page = { data: Req[]; meta: { page: number; pageSize: number; offset: number; total: number; hasMore: boolean; statusCounts: Record<string, number> } };

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'LP', 'Leave Page Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'LP', 'Leave Page Desig', ${SEED}, ${SEED})`);
  // 600 employees: 'Staff 0001' .. 'Staff 0600'.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    SELECT ${TENANT}, 'LP' || lpad(n::text, 4, '0'), 'Staff ' || lpad(n::text, 4, '0'), ${DEPT}, ${DESIG}, '2020-01-01', ${SEED}, ${SEED}
    FROM generate_series(1, 600) AS n`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${MANAGER}, ${TENANT}, 'LP-MGR', 'Mina Manager', ${DEPT}, ${DESIG}, '2015-01-01', ${MANAGER_SUB}, ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by)
    VALUES (${REPORT}, ${TENANT}, 'LP-RPT', 'Ravi Report', ${DEPT}, ${DESIG}, '2018-01-01', ${MANAGER}, ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE}, ${TENANT}, 'LP', 'Casual Leave', ${SEED}, ${SEED})`);

  const emp550 = await asTenant((tx) => tx`SELECT id FROM employee.hrms_employees WHERE tenant_id = ${TENANT} AND employee_no = 'LP0550'`);
  emp550Id = emp550[0]!.id as string;

  // One allocation per employee that has a request (alloc_id is required).
  // 7 requests: #550 (approved, newest), 4 pending for staff 1-4, 1 rejected for staff 5, and the report's pending one.
  const seeds: { emp: string; status: string; at: string }[] = [
    { emp: emp550Id, status: "approved", at: "2026-10-20T10:00:00Z" },
  ];
  for (let n = 1; n <= 4; n++) {
    const r = await asTenant((tx) => tx`SELECT id FROM employee.hrms_employees WHERE tenant_id = ${TENANT} AND employee_no = ${"LP" + String(n).padStart(4, "0")}`);
    seeds.push({ emp: r[0]!.id as string, status: "pending", at: `2026-10-1${n}T10:00:00Z` });
  }
  const r5 = await asTenant((tx) => tx`SELECT id FROM employee.hrms_employees WHERE tenant_id = ${TENANT} AND employee_no = 'LP0005'`);
  seeds.push({ emp: r5[0]!.id as string, status: "rejected", at: "2026-10-05T10:00:00Z" });
  seeds.push({ emp: REPORT, status: "pending", at: "2026-10-06T10:00:00Z" });

  for (const s of seeds) {
    const allocRows = await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES (${TENANT}, ${s.emp}, ${LEAVE_TYPE}, '2026-27', 12, 12, ${SEED}, ${SEED})
      ON CONFLICT DO NOTHING
      RETURNING id`);
    const allocId = allocRows[0]?.id
      ?? (await asTenant((tx) => tx`SELECT id FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT} AND employee_id = ${s.emp} AND leave_type_id = ${LEAVE_TYPE}`))[0]!.id;
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_apps (tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_at, created_by, updated_by)
      VALUES (${TENANT}, ${s.emp}, ${LEAVE_TYPE}, ${allocId as string}, '2026-11-01', '2026-11-01', 1, ${s.status}, ${s.at}, ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const get = (qs: string, headers: Record<string, string> = hr) => app.inject({ method: "GET", url: `/v1/hrms/leave-requests${qs}`, headers });

describe("GET /v1/hrms/leave-requests -- names at scale (GAP-HR-LEAVE-03)", () => {
  it("shows the real name for a request from employee #550 of 600, not 'Unknown employee' or an id fragment", async () => {
    const r = await get("?limit=50");
    expect(r.statusCode).toBe(200);
    const rows = r.json<Req[]>();
    const row = rows.find((x) => x.status === "approved");
    expect(row?.employeeName).toBe("Staff 0550");
    expect(rows.some((x) => x.employeeName === "Unknown employee")).toBe(false);
    expect(rows.some((x) => /^[0-9a-f]{8}$/i.test(x.employeeName))).toBe(false);
  });

  it("lists newest first", async () => {
    const rows = (await get("?limit=50")).json<Req[]>();
    expect(rows[0]!.employeeName).toBe("Staff 0550"); // 2026-10-20 is the latest created_at
  });
});

describe("GET /v1/hrms/leave-requests?withMeta=1 (GAP-HR-LEAVE-03)", () => {
  it("returns { data, meta } with the real total and status counts over everything, not just the page", async () => {
    const r = await get("?withMeta=1&limit=2&offset=0");
    expect(r.statusCode).toBe(200);
    const body = r.json<Page>();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 2, offset: 0, total: 7, hasMore: true });
    expect(body.meta.statusCounts).toEqual({ approved: 1, pending: 5, rejected: 1 });
  });

  it("the last page reports hasMore=false and pages do not overlap", async () => {
    const p1 = (await get("?withMeta=1&limit=4&offset=0")).json<Page>();
    const p2 = (await get("?withMeta=1&limit=4&offset=4")).json<Page>();
    expect(p2.meta).toMatchObject({ page: 2, total: 7, hasMore: false });
    expect(p2.data).toHaveLength(3);
    const ids = [...p1.data, ...p2.data].map((x) => x.id);
    expect(new Set(ids).size).toBe(7);
  });

  it("a manager's total and counts are scoped to their direct reports (one pending request)", async () => {
    const r = await get("?withMeta=1&limit=50", { authorization: tok(["manager"], MANAGER_SUB) });
    expect(r.statusCode).toBe(200);
    const body = r.json<Page>();
    expect(body.meta.total).toBe(1);
    expect(body.meta.statusCounts).toEqual({ pending: 1 });
    expect(body.data.map((x) => x.employeeName)).toEqual(["Ravi Report"]);
  });

  it("an unlinked manager sees an empty page with zero totals, never the tenant's", async () => {
    const r = await get("?withMeta=1&limit=50", { authorization: tok(["manager"], "leave-page-unlinked-mgr") });
    expect(r.statusCode).toBe(200);
    const body = r.json<Page>();
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total: 0, hasMore: false, statusCounts: {} });
  });

  // GAP-HR-LEAVE-04: "Manager without linked employee record sees empty list, not everything."
  it("a manager with NO linked employee record gets an empty list from the plain endpoint too, never the tenant's requests", async () => {
    const r = await get("?limit=50", { authorization: tok(["manager"], "leave-page-unlinked-mgr") });
    expect(r.statusCode).toBe(200);
    expect(r.json<unknown[]>()).toEqual([]);
  });

  it("a linked manager sees their direct reports' requests only -- not their own, and not anyone else's", async () => {
    const rows = (await get("?limit=50", { authorization: tok(["manager"], MANAGER_SUB) })).json<Req[]>();
    expect(rows.map((x) => x.employeeName)).toEqual(["Ravi Report"]);
  });

  it("is still the bare array when withMeta is not asked for", async () => {
    const body = (await get("?limit=50")).json<unknown>();
    expect(Array.isArray(body)).toBe(true);
  });

  it("rejects a withMeta value it does not understand", async () => {
    expect((await get("?withMeta=yes")).statusCode).toBe(400);
  });
});

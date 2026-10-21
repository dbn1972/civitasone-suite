/**
 * GET /v1/hrms/overtime-requests — server-side `summary` (real DB, no mocks).
 *
 * GAP-HR-OVERTIME-04: the web stat cards (Pending / Approved / Approved Hours)
 * were counted from the rows of the loaded page, so they undercounted as soon
 * as the list spanned more than one page. The route now returns a `summary`
 * aggregated over the SAME scope as the list (tenant, self / direct reports,
 * empId filter), independent of limit/offset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

// Set for every hrms-service test run by vitest.config.ts (test.env); no literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const EMPTY_TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const DEPT_ID = randomUUID();
const DESIG_ID = randomUUID();
const MANAGER_ID = randomUUID();
const REPORT_ID = randomUUID();
const OUTSIDER_ID = randomUUID();
const MANAGER_SUB = `ot-sum-mgr-${randomUUID()}`;

function auth(roles: string[], sub: string, tid = TENANT): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-ot-summary" }, SECRET, 3600)}` };
}
const asTenant = <T,>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

async function seedOt(employeeId: string, date: string, hours: string, status: string): Promise<void> {
  await asTenant((tx) => tx`
    INSERT INTO attendance.hrms_overtime_requests (id, tenant_id, employee_id, request_date, hours_requested, status, created_by, updated_by)
    VALUES (gen_random_uuid(), ${TENANT}, ${employeeId}, ${date}, ${hours}, ${status}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'OTS', 'OT Summary Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'OTS', 'OT Summary Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name, managerId, userRef] of [
    [MANAGER_ID, "OTS-001", "OT Summary Manager", null, MANAGER_SUB],
    [REPORT_ID, "OTS-002", "OT Summary Report", MANAGER_ID, null],
    [OUTSIDER_ID, "OTS-003", "OT Summary Outsider", null, null],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${managerId}, ${userRef}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  // report (inside the manager's scope): 1 pending 2.00h, 1 approved 3.00h
  await seedOt(REPORT_ID, "2026-05-01", "2.00", "pending");
  await seedOt(REPORT_ID, "2026-05-02", "3.00", "approved");
  // outsider (outside it): 1 pending 1.50h, 1 approved 4.25h, 1 rejected 5.00h
  await seedOt(OUTSIDER_ID, "2026-05-03", "1.50", "pending");
  await seedOt(OUTSIDER_ID, "2026-05-04", "4.25", "approved");
  await seedOt(OUTSIDER_ID, "2026-05-05", "5.00", "rejected");
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_overtime_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/overtime-requests — summary", () => {
  it("HR sees the whole tenant: per-status counts and APPROVED hours only", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: auth(["hr_admin"], "ot-sum-hr") });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.summary).toEqual({ total: 5, pending: 2, approved: 2, rejected: 1, approvedHours: 7.25 });
    expect(body.total).toBe(5);
  });

  it("the summary covers the whole scope even when limit truncates the page", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests?limit=1&offset=0", headers: auth(["hr_admin"], "ot-sum-hr") });
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.summary).toEqual({ total: 5, pending: 2, approved: 2, rejected: 1, approvedHours: 7.25 });
    expect(body.total).toBe(body.summary.total);
  });

  it("a manager's summary counts only themselves and their direct reports, never the rest of the tenant", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: auth(["manager"], MANAGER_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json().summary).toEqual({ total: 2, pending: 1, approved: 1, rejected: 0, approvedHours: 3 });
  });

  it("an empId filter narrows the summary to that employee", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/overtime-requests?empId=${OUTSIDER_ID}`, headers: auth(["hr_admin"], "ot-sum-hr") });
    expect(r.json().summary).toEqual({ total: 3, pending: 1, approved: 1, rejected: 1, approvedHours: 4.25 });
  });

  it("another tenant's rows are never counted", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: auth(["hr_admin"], "ot-sum-hr", EMPTY_TENANT) });
    expect(r.statusCode).toBe(200);
    expect(r.json().summary).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0, approvedHours: 0 });
  });
});

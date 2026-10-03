/**
 * GAP-HR-DASHBOARD-08 -- a manager-only viewer's dashboard covers their direct
 * reports (default dashboard_scope policy), not the whole tenant; HR is never
 * scoped; a tenant can opt back into organisation-wide. Real DB, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerPolicySettingsConsumers } from "../modules/policy-settings/consumer.js";

registerPolicySettingsConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a909-4000-8000-000000000a99";
const SEED = "facade00-a909-4000-8000-0000000000ff";
const DEPT = "facade00-a909-4000-8000-0000000000d1";
const DESIG = "facade00-a909-4000-8000-0000000000d2";
const MGR = "facade00-a909-4000-8000-0000000000e1";
const R1 = "facade00-a909-4000-8000-0000000000e2";
const R2 = "facade00-a909-4000-8000-0000000000e3";
const OUTSIDER = "facade00-a909-4000-8000-0000000000e4";
const OUTSIDER2 = "facade00-a909-4000-8000-0000000000e5";
const HR = "facade00-a909-4000-8000-0000000000e9";
const LT = "facade00-a909-4000-8000-0000000000c1";
const ALLOC = "facade00-a909-4000-8000-0000000000a1";

const as = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-dash-scope" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_policy_settings WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'DS', 'Scope Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'DS', 'Scope Desig', ${SEED}, ${SEED})`);
  for (const [id, no, mgr] of [[MGR, "DS-1", null], [R1, "DS-2", MGR], [R2, "DS-3", MGR], [OUTSIDER, "DS-4", null], [OUTSIDER2, "DS-5", null], [HR, "DS-9", null]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${no}, ${DEPT}, ${DESIG}, '2015-01-01', 'permanent', ${id}, ${mgr}, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LT}, ${TENANT}, 'CL', 'Casual Leave', ${SEED}, ${SEED})`);
  for (const e of [R1, OUTSIDER, OUTSIDER2]) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${e}, ${LT}, ${ALLOC}, '2026-11-02', '2026-11-02', 1, 'pending', ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const dash = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/hrms/dashboard", headers });
const inbox = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/hrms/dashboard/pending-leaves", headers });

describe("dashboard manager scope (GAP-HR-DASHBOARD-08)", () => {
  it("HR sees the whole tenant (6 people, 3 pending leaves) and scope=organisation", async () => {
    const r = await dash(as(HR, ["hr_admin"]));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ headcount: 6, pendingLeaves: 3, scope: "organisation" });
    expect((await inbox(as(HR, ["hr_admin"]))).json().data).toHaveLength(3);
  });

  it("a manager sees only their direct reports by default: 2 people, 1 pending leave, scope=direct_reports", async () => {
    const r = await dash(as(MGR, ["manager"]));
    expect(r.json()).toMatchObject({ headcount: 2, pendingLeaves: 1, scope: "direct_reports", totalDepartments: 1 });
    expect(r.json().departmentBreakdown).toEqual([{ name: "Scope Dept", count: 2 }]);
    const items = (await inbox(as(MGR, ["manager"]))).json().data as Array<{ employeeNo: string }>;
    expect(items.map((i) => i.employeeNo)).toEqual(["DS-2"]);
  });

  it("a manager with no reports (or no linked employee) sees zeros, never the tenant", async () => {
    const lonely = await dash(as(OUTSIDER, ["manager"]));
    expect(lonely.json()).toMatchObject({ headcount: 0, pendingLeaves: 0, scope: "direct_reports" });
    expect((await inbox(as(OUTSIDER, ["manager"]))).json().data).toHaveLength(0);
    const unlinked = await dash(as(randomUUID(), ["manager"]));
    expect(unlinked.json()).toMatchObject({ headcount: 0, pendingLeaves: 0, scope: "direct_reports" });
  });

  it("a manager who is ALSO HR is not scoped", async () => {
    const r = await dash(as(MGR, ["manager", "hr_officer"]));
    expect(r.json()).toMatchObject({ headcount: 6, scope: "organisation" });
  });

  it("a tenant can opt back into organisation-wide for managers via the policy", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/dashboard_scope", headers: as(HR, ["hr_admin"]), payload: { managerScope: "organisation" } });
    expect(put.statusCode).toBe(202);
    await drain();
    const r = await dash(as(MGR, ["manager"]));
    expect(r.json()).toMatchObject({ headcount: 6, pendingLeaves: 3, scope: "organisation" });
  });
});

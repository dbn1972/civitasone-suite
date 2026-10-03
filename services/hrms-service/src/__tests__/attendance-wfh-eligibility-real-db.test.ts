/**
 * GAP-HR-WFH-01 -- gazetted / pay-level WFH exclusion + eligibility read, real DB.
 * Pay level = hrms_designations.level (7th CPC level, 0 = unclassified); the
 * threshold and the on/off switch are per-tenant policy (wfh_eligibility).
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
const TENANT = "facade00-a907-4000-8000-000000000a97";
const SEED = "facade00-a907-4000-8000-0000000000ff";
const DEPT = "facade00-a907-4000-8000-0000000000d1";
const D_L12 = "facade00-a907-4000-8000-0000000000d2";
const D_L8 = "facade00-a907-4000-8000-0000000000d3";
const D_L0 = "facade00-a907-4000-8000-0000000000d4";
const E_L12 = "facade00-a907-4000-8000-0000000000e2";
const E_L8 = "facade00-a907-4000-8000-0000000000e3";
const E_L0 = "facade00-a907-4000-8000-0000000000e4";
const HR = "facade00-a907-4000-8000-0000000000e9";

const tok = (roles: string[], sub: string) => signToken({ sub, tid: TENANT, roles, sid: "sess-wfh-elig" }, SECRET);
const as = (sub: string, roles = ["employee"]) => ({ authorization: `Bearer ${tok(roles, sub)}` });

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_wfh_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_policy_settings WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'WE', 'WFH Elig Dept', ${SEED}, ${SEED})`);
  for (const [id, code, level] of [[D_L12, "L12", 12], [D_L8, "L8", 8], [D_L0, "L0", 0]] as const) {
    await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${id}, ${TENANT}, ${code}, ${code}, ${level}, ${SEED}, ${SEED})`);
  }
  for (const [id, no, desig] of [[E_L12, "WE-12", D_L12], [E_L8, "WE-08", D_L8], [E_L0, "WE-00", D_L0], [HR, "WE-HR", D_L8]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${no}, ${DEPT}, ${desig}, '2015-01-01', 'permanent', ${id}, ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const wfh = (sub: string, employeeId: string, day: string) => app.inject({
  method: "POST", url: "/v1/hrms/wfh-requests", headers: as(sub),
  payload: { employeeId, fromDate: day, toDate: day },
});

describe("WFH gazetted exclusion (GAP-HR-WFH-01)", () => {
  it("rejects a Level 12 employee's own request with GAZETTED_NOT_ELIGIBLE (422)", async () => {
    const r = await wfh(E_L12, E_L12, "2026-11-02");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("GAZETTED_NOT_ELIGIBLE");
  });
  it("allows Level 8, and an UNCLASSIFIED (level 0) designation is never blocked", async () => {
    expect((await wfh(E_L8, E_L8, "2026-11-02")).statusCode).toBe(202);
    expect((await wfh(E_L0, E_L0, "2026-11-02")).statusCode).toBe(202);
  });
  it("Level 10 is the boundary: excluded (Group A is Levels 10-18); Level 9 is still eligible", async () => {
    await asTenant((tx) => tx`UPDATE employee.hrms_designations SET level = 10 WHERE id = ${D_L12}`);
    const ten = await wfh(E_L12, E_L12, "2026-11-09");
    expect(ten.statusCode).toBe(422);
    expect(ten.json().code).toBe("GAZETTED_NOT_ELIGIBLE");
    await asTenant((tx) => tx`UPDATE employee.hrms_designations SET level = 9 WHERE id = ${D_L12}`);
    expect((await wfh(E_L12, E_L12, "2026-11-09")).statusCode).toBe(202);
    await asTenant((tx) => tx`UPDATE employee.hrms_designations SET level = 12 WHERE id = ${D_L12}`);
  });
  it("GET /wfh-eligibility reports the level, gazetted flag and this week's count; employees can only ask about themselves", async () => {
    const mine = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${E_L12}`, headers: as(E_L12) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ payLevel: 12, maxPayLevel: 9, gazetted: true, weeklyCap: 2 });
    const unknown = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${E_L0}`, headers: as(E_L0) });
    expect(unknown.json()).toMatchObject({ payLevel: null, gazetted: false });
    const other = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${E_L12}`, headers: as(E_L8) });
    expect(other.statusCode).toBe(403);
  });
  it("only an HR admin can change the policy; raising the threshold or switching it off lets Level 12 through", async () => {
    const denied = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/wfh_eligibility", headers: as(E_L8), payload: { enforceGazettedExclusion: false, maxPayLevel: 10 } });
    expect(denied.statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/wfh_eligibility", headers: as(HR, ["hr_admin"]), payload: { maxPayLevel: 99 } });
    expect(bad.statusCode).toBe(400);
    const unknownKey = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/nope", headers: as(HR, ["hr_admin"]), payload: {} });
    expect(unknownKey.statusCode).toBe(404);
    const ok = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/wfh_eligibility", headers: as(HR, ["hr_admin"]), payload: { enforceGazettedExclusion: true, maxPayLevel: 12 } });
    expect(ok.statusCode).toBe(202);
    await drain();
    expect((await wfh(E_L12, E_L12, "2026-11-16")).statusCode).toBe(202);
    const off = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/wfh_eligibility", headers: as(HR, ["hr_admin"]), payload: { enforceGazettedExclusion: false, maxPayLevel: 10 } });
    expect(off.statusCode).toBe(202);
    await drain();
    expect((await wfh(E_L12, E_L12, "2026-11-23")).statusCode).toBe(202);
    const list = await app.inject({ method: "GET", url: "/v1/hrms/policy-settings", headers: as(HR, ["hr_officer"]) });
    const row = list.json().data.find((p: { key: string }) => p.key === "wfh_eligibility");
    expect(row).toMatchObject({ isDefault: false, value: { enforceGazettedExclusion: false, maxPayLevel: 10 } });
  });
});

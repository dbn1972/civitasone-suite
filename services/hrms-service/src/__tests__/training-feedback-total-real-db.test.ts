/**
 * GAP-HR-TRAINING-FEEDBACK-04 -- GET /v1/hrms/training/feedback reports the
 * REAL number of completed nominations, real DB, no mocks.
 *
 * The endpoint returned `total: data.length`, which is the LIMIT 500 row cap, so
 * the page's "Showing latest 500 of N" notice always read N = 500 whatever the
 * tenant actually had.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";
const BIG = "facade00-a04d-4000-8000-000000000051";
const SMALL = "facade00-a04d-4000-8000-000000000052";
const SEED = randomUUID();
const tok = (roles: string[], tid: string) => signToken({ sub: randomUUID(), tid, roles, sid: "sess-feedback-total" }, SECRET);
const hr = (tid: string) => ({ authorization: `Bearer ${tok(["hr_officer"], tid)}` });

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);

async function cleanup(): Promise<void> {
  for (const t of [BIG, SMALL]) {
    await asTenant(t, (tx) => tx`DELETE FROM training.hrms_nominations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM training.hrms_trainings WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

/** One employee + `completed` trainings each with a completed nomination + one merely-nominated one. */
async function seedTenant(tenant: string, completed: number): Promise<void> {
  const dept = randomUUID(), desig = randomUUID(), emp = randomUUID();
  await asTenant(tenant, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${dept}, ${tenant}, 'FB', 'Feedback Dept', ${SEED}, ${SEED})`);
  await asTenant(tenant, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${desig}, ${tenant}, 'FB-D', 'Feedback Desig', ${SEED}, ${SEED})`);
  await asTenant(tenant, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${emp}, ${tenant}, 'FB-001', 'Feedback Employee', ${dept}, ${desig}, '2015-01-01', 'permanent', ${emp}, ${SEED}, ${SEED})`);
  // completed + 1 trainings (the extra one gets a NOT-completed nomination)
  await asTenant(tenant, (tx) => tx`
    INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, created_by, updated_by)
    SELECT gen_random_uuid(), ${tenant}::uuid, 'Programme ' || g::text, '2026-01-01'::date, '2026-01-02'::date, ${SEED}::uuid, ${SEED}::uuid
    FROM generate_series(1, ${completed + 1}::int) AS g`);
  await asTenant(tenant, (tx) => tx`
    INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, completed_date, score, created_by, updated_by)
    SELECT gen_random_uuid(), t.tenant_id, t.id, ${emp}::uuid,
           CASE WHEN t.title = 'Programme ' || ${completed + 1}::text THEN 'nominated' ELSE 'completed' END,
           CASE WHEN t.title = 'Programme ' || ${completed + 1}::text THEN NULL ELSE '2026-02-01'::date END,
           CASE WHEN t.title = 'Programme ' || ${completed + 1}::text THEN NULL ELSE 80 END,
           ${SEED}::uuid, ${SEED}::uuid
    FROM training.hrms_trainings t WHERE t.tenant_id = ${tenant}`);
}

beforeAll(async () => {
  await cleanup();
  await seedTenant(BIG, 501);
  await seedTenant(SMALL, 3);
  app = await buildApp();
}, 60_000);
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); }, 60_000);

const get = (tid: string) => app.inject({ method: "GET", url: "/v1/hrms/training/feedback", headers: hr(tid) });

describe("GET /v1/hrms/training/feedback total (GAP-HR-TRAINING-FEEDBACK-04)", () => {
  it("over the 500 cap: returns 500 rows but the REAL total (501) and truncated=true -- never total = 500", async () => {
    const r = await get(BIG);
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: unknown[]; total: number; truncated: boolean };
    expect(body.data).toHaveLength(500);
    expect(body.total).toBe(501); // the merely-nominated row is not counted
    expect(body.truncated).toBe(true);
  });

  it("under the cap: total equals the rows shown and truncated=false", async () => {
    const r = await get(SMALL);
    const body = r.json() as { data: Array<{ employee: string; program: string; score: number; submittedOn: string }>; total: number; truncated: boolean };
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.data[0]).toMatchObject({ employee: "Feedback Employee", score: 80, submittedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("is tenant-scoped and HR-only", async () => {
    const other = await get(randomUUID());
    expect(other.json()).toEqual({ data: [], total: 0, truncated: false });
    const mgr = await app.inject({ method: "GET", url: "/v1/hrms/training/feedback", headers: { authorization: `Bearer ${tok(["manager"], SMALL)}` } });
    expect(mgr.statusCode).toBe(403);
  });
});

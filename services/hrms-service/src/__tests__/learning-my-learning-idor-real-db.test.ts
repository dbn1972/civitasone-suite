/**
 * GAP-LEARNING-MY-LEARNING-01 / GAP-LEARNING-COURSES-DETAIL-02 — IDOR
 * regression, real-DB round-trip, no mocks.
 *
 * Before the fix:
 *  - GET /v1/hrms/learning/my-learning?employeeId=<any uuid> was gated only on
 *    ALL_ROLES, so any employee could read a colleague's enrolments by editing
 *    the UUID (DPDP personal data leak).
 *  - POST /v1/hrms/learning/courses/:id/enroll took employeeId from the body
 *    with no self-scope, so any employee could enrol a colleague.
 *
 * After the fix a bare employee is forced onto their OWN linked
 * hrms_employees record for both; HR passes through; a non-HR caller with no
 * employee link fails closed (403 on enrol, [] on my-learning).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_learning_Consumers } from "../modules/learning/f3-consumer.js";

registerF3_learning_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const TENANT    = "facade00-1ea2-4000-8000-000000000a01";
const SEED_ACTOR = "facade00-1ea2-4000-8000-0000000000ff";
const DEPT_ID   = "facade00-1ea2-4000-8000-0000000000d1";
const DESIG_ID  = "facade00-1ea2-4000-8000-0000000000d2";

// Employee A: linked to actor-sub A_SUB via user_ref.
const EMP_A    = "facade00-1ea2-4000-8000-0000000000e1";
const A_SUB    = "learning-idor-emp-a";
// Employee B: the victim, a different person in the same tenant.
const EMP_B    = "facade00-1ea2-4000-8000-0000000000e2";
const B_SUB    = "learning-idor-emp-b";

const COURSE_ID = "facade00-1ea2-4000-8000-0000000000c1";
const COURSE2_ID = "facade00-1ea2-4000-8000-0000000000c2";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-learning-idor" }, SECRET);
}
const empAToken = tok(["employee"], A_SUB);
const hrToken   = tok(["hr_admin"], "learning-idor-hr");

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM learning.enrollments WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM learning.courses WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'LRNIDOR', 'Learning IDOR Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'LRNIDOR', 'Learning IDOR Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${EMP_A}, ${TENANT}, 'LRN-A', 'Learning Emp A', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${A_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${EMP_B}, ${TENANT}, 'LRN-B', 'Learning Emp B', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${B_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})`);

  // Two published courses.
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${COURSE_ID}, ${TENANT}, 'C-IDOR-1', 'IDOR Course One', 'general', '2', 'published', ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${COURSE2_ID}, ${TENANT}, 'C-IDOR-2', 'IDOR Course Two', 'general', '3', 'published', ${SEED_ACTOR})`);

  // Victim B is enrolled in COURSE_ID; A has nothing.
  await asTenant((tx) => tx`
    INSERT INTO learning.enrollments (id, tenant_id, course_id, employee_id, status, progress_pct)
    VALUES (gen_random_uuid(), ${TENANT}, ${COURSE_ID}, ${EMP_B}, 'in_progress', 40)`);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/learning/my-learning — IDOR (GAP-LEARNING-MY-LEARNING-01)", () => {
  it("bare employee A requesting B's uuid gets A's own (empty) rows, NOT B's", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`,
      headers: { authorization: `Bearer ${empAToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ employeeId: string }>;
    expect(rows.every((e) => e.employeeId === EMP_A)).toBe(true);
    expect(rows.some((e) => e.employeeId === EMP_B)).toBe(false);
  });

  it("bare employee with no employeeId query sees their own rows", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/learning/my-learning`,
      headers: { authorization: `Bearer ${empAToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ employeeId: string }>;
    expect(rows.every((e) => e.employeeId === EMP_A)).toBe(true);
  });

  it("HR requesting B's uuid gets B's enrolments (unrestricted)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ employeeId: string; courseId: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.employeeId).toBe(EMP_B);
    expect(rows[0]!.courseId).toBe(COURSE_ID);
  });
});

describe("POST /v1/hrms/learning/courses/:id/enroll — self-scope (GAP-LEARNING-COURSES-DETAIL-02)", () => {
  it("bare employee A enrolling with B's uuid is enrolled as SELF (A), not B", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/learning/courses/${COURSE2_ID}/enroll`,
      headers: { authorization: `Bearer ${empAToken}` },
      payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const forA = await asTenant((tx) => tx`SELECT employee_id FROM learning.enrollments WHERE tenant_id = ${TENANT} AND course_id = ${COURSE2_ID}`);
    expect(forA.length).toBe(1);
    expect(forA[0]!.employee_id).toBe(EMP_A);
  });

  it("HR enrolling B on COURSE2 creates an enrolment for B (enrol-on-behalf preserved)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/learning/courses/${COURSE2_ID}/enroll`,
      headers: { authorization: `Bearer ${hrToken}` },
      payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const forB = await asTenant((tx) => tx`SELECT employee_id FROM learning.enrollments WHERE tenant_id = ${TENANT} AND course_id = ${COURSE2_ID} AND employee_id = ${EMP_B}`);
    expect(forB.length).toBe(1);
  });
});

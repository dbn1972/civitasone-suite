/**
 * GAP2-LEARNING-ASSESSMENTS-ATTEMPT-01 + GAP2-LEARNING-ENROLLMENTS-IDOR-01 —
 * real-DB IDOR / impersonation regression, no mocks.
 *
 * Before the fix:
 *  - POST /v1/hrms/assessments/:id/attempts trusted body.employeeId with no
 *    self-scope, so a bare employee could start (and ultimately certify) an
 *    assessment under a COLLEAGUE's employeeId — certification fraud.
 *  - GET /v1/hrms/learning/enrollments/:id and PATCH .../progress were scoped
 *    only by tenant, so a bare employee could read / overwrite any colleague's
 *    enrolment.
 *
 * After the fix a bare employee is force-scoped onto their OWN linked
 * hrms_employees record (attempt start/submit), and the by-id enrolment
 * routes 404 for a non-owning bare employee. HR/manager pass through.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_assessment_Consumers } from "../modules/assessment/f3-consumer.js";

registerF3_assessment_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const TENANT     = "facade00-1ea2-4000-8000-000000000b01";
const SEED_ACTOR = "facade00-1ea2-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-1ea2-4000-8000-0000000000f1";
const DESIG_ID   = "facade00-1ea2-4000-8000-0000000000f2";

const EMP_A = "facade00-1ea2-4000-8000-0000000000a1";
const A_SUB = "assess-idor-emp-a";
const EMP_B = "facade00-1ea2-4000-8000-0000000000a2";
const B_SUB = "assess-idor-emp-b";

const BANK_ID   = "facade00-1ea2-4000-8000-0000000000b2";
const ASSESS_ID = "facade00-1ea2-4000-8000-0000000000b3";
const COURSE_ID = "facade00-1ea2-4000-8000-0000000000b4";
const ENROLL_B  = "facade00-1ea2-4000-8000-0000000000b5";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-assess-idor" }, SECRET);
}
const empAToken = tok(["employee"], A_SUB);
const hrToken   = tok(["hr_admin"], "assess-idor-hr");

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM assessment.certificates WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.attempt_answers WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.attempts WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.assessments WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.questions WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.question_banks WHERE tenant_id = ${TENANT}`);
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
    VALUES (${DEPT_ID}, ${TENANT}, 'ASIDOR', 'Assess IDOR Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'ASIDOR', 'Assess IDOR Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${EMP_A}, ${TENANT}, 'AS-A', 'Assess Emp A', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${A_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${EMP_B}, ${TENANT}, 'AS-B', 'Assess Emp B', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${B_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})`);

  // A published assessment backed by a bank + one true/false question.
  await asTenant((tx) => tx`
    INSERT INTO assessment.question_banks (id, tenant_id, title, created_by)
    VALUES (${BANK_ID}, ${TENANT}, 'IDOR Bank', ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO assessment.questions (tenant_id, bank_id, qtype, stem, options, correct, marks)
    VALUES (${TENANT}, ${BANK_ID}, 'truefalse', 'Is the sky blue?',
            ${JSON.stringify([{ id: "t", text: "True" }, { id: "f", text: "False" }])}::jsonb,
            ${JSON.stringify(["t"])}::jsonb, '10')`);
  await asTenant((tx) => tx`
    INSERT INTO assessment.assessments (id, tenant_id, title, bank_id, passing_score, status, created_by)
    VALUES (${ASSESS_ID}, ${TENANT}, 'IDOR Assessment', ${BANK_ID}, '5', 'published', ${SEED_ACTOR})`);

  // A course + an enrolment owned by victim B.
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${COURSE_ID}, ${TENANT}, 'AS-C1', 'Assess IDOR Course', 'general', '1', 'published', ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO learning.enrollments (id, tenant_id, course_id, employee_id, status, progress_pct)
    VALUES (${ENROLL_B}, ${TENANT}, ${COURSE_ID}, ${EMP_B}, 'in_progress', 20)`);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/assessments/:id/attempts — impersonation (GAP2-ATTEMPT-01)", () => {
  it("bare employee A starting an attempt under B's uuid is force-scoped to A, never B", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/assessments/${ASSESS_ID}/attempts`,
      headers: { authorization: `Bearer ${empAToken}` },
      payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const rows = await asTenant((tx) => tx`
      SELECT employee_id FROM assessment.attempts WHERE tenant_id = ${TENANT} AND assessment_id = ${ASSESS_ID}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.employee_id).toBe(EMP_A);
    // No attempt was ever created under B.
    expect(rows.some((x) => x.employee_id === EMP_B)).toBe(false);
  });

  it("HR starting an attempt on behalf of B is honoured (B's attempt created)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/assessments/${ASSESS_ID}/attempts`,
      headers: { authorization: `Bearer ${hrToken}` },
      payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const forB = await asTenant((tx) => tx`
      SELECT employee_id FROM assessment.attempts WHERE tenant_id = ${TENANT} AND assessment_id = ${ASSESS_ID} AND employee_id = ${EMP_B}`);
    expect(forB.length).toBe(1);
  });
});

describe("learning/enrollments/:id — IDOR (GAP2-ENROLLMENTS-IDOR-01)", () => {
  it("bare employee A reading B's enrolment id is 404 (not B's data)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/learning/enrollments/${ENROLL_B}`,
      headers: { authorization: `Bearer ${empAToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("bare employee A patching B's enrolment to 100% is 404 and does NOT complete B", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/learning/enrollments/${ENROLL_B}/progress`,
      headers: { authorization: `Bearer ${empAToken}` },
      payload: { percentComplete: 100 },
    });
    expect(r.statusCode).toBe(404);
    await drain();
    const after = await asTenant((tx) => tx`
      SELECT status, progress_pct FROM learning.enrollments WHERE id = ${ENROLL_B} AND tenant_id = ${TENANT}`);
    expect(after[0]!.status).toBe("in_progress");
    expect(Number(after[0]!.progress_pct)).toBe(20);
  });

  it("HR reading B's enrolment id succeeds (pass-through)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/learning/enrollments/${ENROLL_B}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { employeeId: string }).employeeId).toBe(EMP_B);
  });
});

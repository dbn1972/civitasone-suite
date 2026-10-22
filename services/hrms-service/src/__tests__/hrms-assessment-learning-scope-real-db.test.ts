/**
 * Security regression (real DB, no mocks):
 *
 *  1. Assessment answer-key leak: GET /assessment/question-banks/:id/questions
 *     returns the `correct` column, so it is restricted to the bank author/admin
 *     role set (HR). Employees and managers get 403.
 *  2. Owner decision 2 (2026-10-14): managers read their DIRECT REPORTS only on
 *     learning dashboard / my-learning / enrollments/:id, competency
 *     profile + gap-analysis, and GET /nominations (403 otherwise). HR keeps
 *     tenant-wide access. Competency reads of another employee are audited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_learning_Consumers } from "../modules/learning/f3-consumer.js";
import { registerF3_competency_Consumers } from "../modules/competency/f3-consumer.js";

registerF3_learning_Consumers(queue);
registerF3_competency_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const TENANT     = "facade00-5c0e-4000-8000-000000000c01";
const SEED_ACTOR = "facade00-5c0e-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-5c0e-4000-8000-0000000000d1";
const DESIG_ID   = "facade00-5c0e-4000-8000-0000000000d2";
const EMP_M = "facade00-5c0e-4000-8000-0000000000e1"; const M_SUB = "facade00-5c0e-4000-8000-0000000000a1";
const EMP_R = "facade00-5c0e-4000-8000-0000000000e2"; const R_SUB = "scope-report";
const EMP_O = "facade00-5c0e-4000-8000-0000000000e3"; const O_SUB = "scope-other";
const HR_SUB = "facade00-5c0e-4000-8000-0000000000a2";
const COURSE_ID = "facade00-5c0e-4000-8000-0000000000c1";
const ENROL_R = "facade00-5c0e-4000-8000-0000000000f1";
const ENROL_O = "facade00-5c0e-4000-8000-0000000000f2";
const BANK_ID = "facade00-5c0e-4000-8000-0000000000b1";

const bearer = (roles: string[], sub: string): { authorization: string } =>
  ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-hrms-scope" }, SECRET)}` });
const MGR = bearer(["manager"], M_SUB);
const EMP = bearer(["employee"], O_SUB);
const HR  = bearer(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.questions WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM assessment.question_banks WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM learning.enrollments WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM learning.courses WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

type AuditRow = { actorId: string; payload: Record<string, unknown> };
async function competencyReads(target: string, view: string): Promise<AuditRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as AuditRow[]).filter((r) => {
    const p = r.payload ?? {};
    return p.resourceType === "employee_competency" && p.resourceId === target && p.view === view;
  });
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'SCOPE', 'Scope Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'SCOPE', 'Scope Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name, sub, mgr] of [
    [EMP_M, "SC-M", "Scope Manager", M_SUB, null],
    [EMP_R, "SC-R", "Scope Report", R_SUB, EMP_M],
    [EMP_O, "SC-O", "Scope Other", O_SUB, null],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${sub}, ${mgr}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${COURSE_ID}, ${TENANT}, 'SC-1', 'Scope Course', 'general', '1', 'published', ${SEED_ACTOR})`);
  for (const [id, emp] of [[ENROL_R, EMP_R], [ENROL_O, EMP_O]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO learning.enrollments (id, tenant_id, course_id, employee_id, status, progress_pct)
      VALUES (${id}, ${TENANT}, ${COURSE_ID}, ${emp}, 'in_progress', 30)`);
  }
  await asTenant((tx) => tx`
    INSERT INTO assessment.question_banks (id, tenant_id, title, created_by)
    VALUES (${BANK_ID}, ${TENANT}, 'Scope Bank', ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO assessment.questions (tenant_id, bank_id, qtype, stem, options, correct, marks)
    VALUES (${TENANT}, ${BANK_ID}, 'truefalse', 'Is the sky blue?',
            ${JSON.stringify([{ id: "t", text: "True" }, { id: "f", text: "False" }])}::jsonb,
            ${JSON.stringify(["t"])}::jsonb, '10')`);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const get = (url: string, headers: { authorization: string }) => app.inject({ method: "GET", url, headers });

describe("GET /assessment/question-banks/:id/questions — answer key is author/admin only", () => {
  const url = `/v1/hrms/assessment/question-banks/${BANK_ID}/questions`;
  it("a bare employee gets 403 and no answer key", async () => {
    const r = await get(url, EMP);
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain("correct");
  });
  it("a manager gets 403", async () => {
    expect((await get(url, MGR)).statusCode).toBe(403);
  });
  it("HR (bank author/admin) reads the questions including the answer key", async () => {
    const r = await get(url, HR);
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ correct: string[] }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.correct).toEqual(["t"]);
  });
});

describe("learning reads — manager limited to direct reports", () => {
  it.each([
    ["my-learning", (id: string) => `/v1/hrms/learning/my-learning?employeeId=${id}`],
    ["dashboard", (id: string) => `/v1/hrms/learning/dashboard?employeeId=${id}`],
  ])("%s: manager -> non-report 403, direct report 200, HR 200", async (_n, urlFor) => {
    expect((await get(urlFor(EMP_O), MGR)).statusCode).toBe(403);
    expect((await get(urlFor(EMP_R), MGR)).statusCode).toBe(200);
    expect((await get(urlFor(EMP_M), MGR)).statusCode).toBe(200); // self
    expect((await get(urlFor(EMP_O), HR)).statusCode).toBe(200);
  });

  it("my-learning as a manager returns the report's enrolment", async () => {
    const r = await get(`/v1/hrms/learning/my-learning?employeeId=${EMP_R}`, MGR);
    expect((r.json() as Array<{ employeeId: string }>).map((x) => x.employeeId)).toEqual([EMP_R]);
  });

  it("enrollments/:id: manager -> non-report 403, direct report 200, HR 200, bare employee 404", async () => {
    expect((await get(`/v1/hrms/learning/enrollments/${ENROL_O}`, MGR)).statusCode).toBe(403);
    expect((await get(`/v1/hrms/learning/enrollments/${ENROL_R}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/learning/enrollments/${ENROL_O}`, HR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/learning/enrollments/${ENROL_R}`, EMP)).statusCode).toBe(404);
  });
});

describe("GET /nominations — manager limited to direct reports", () => {
  it("manager -> non-report 403, direct report 200, self 200, HR 200", async () => {
    expect((await get(`/v1/hrms/nominations?employeeId=${EMP_O}`, MGR)).statusCode).toBe(403);
    expect((await get(`/v1/hrms/nominations?employeeId=${EMP_R}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/nominations?employeeId=${EMP_M}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/nominations?employeeId=${EMP_O}`, HR)).statusCode).toBe(200);
  });
});

describe("competency profile / gap-analysis — scope + audit", () => {
  const profile = (id: string) => `/v1/hrms/competency/employees/${id}/profile`;
  const gap = (id: string) => `/v1/hrms/competency/gap-analysis?employeeId=${id}&roleCode=ANY`;

  it("manager -> non-report 403 on both routes, with no audit row", async () => {
    expect((await get(profile(EMP_O), MGR)).statusCode).toBe(403);
    expect((await get(gap(EMP_O), MGR)).statusCode).toBe(403);
    await drain();
    expect((await competencyReads(EMP_O, "profile")).length).toBe(0);
    expect((await competencyReads(EMP_O, "gap-analysis")).length).toBe(0);
  });

  it("manager reading a direct report gets 200 and an audit row naming the manager", async () => {
    expect((await get(profile(EMP_R), MGR)).statusCode).toBe(200);
    expect((await get(gap(EMP_R), MGR)).statusCode).toBe(200);
    await drain();
    const p = await competencyReads(EMP_R, "profile");
    const g = await competencyReads(EMP_R, "gap-analysis");
    expect(p.length).toBe(1);
    expect(g.length).toBe(1);
    expect(p[0]!.actorId).toBe(M_SUB);
  });

  it("HR reading another employee gets 200 and an audit row", async () => {
    expect((await get(profile(EMP_O), HR)).statusCode).toBe(200);
    expect((await get(gap(EMP_O), HR)).statusCode).toBe(200);
    await drain();
    expect((await competencyReads(EMP_O, "profile")).length).toBe(1);
    expect((await competencyReads(EMP_O, "gap-analysis")).length).toBe(1);
  });

  it("a manager reading their OWN record is not audited", async () => {
    expect((await get(profile(EMP_M), MGR)).statusCode).toBe(200);
    await drain();
    expect((await competencyReads(EMP_M, "profile")).length).toBe(0);
  });

  it("a bare employee still reads only their own record (404 for others), unaudited", async () => {
    expect((await get(profile(EMP_R), EMP)).statusCode).toBe(404);
    expect((await get(profile(EMP_O), EMP)).statusCode).toBe(200);
    await drain();
    expect((await competencyReads(EMP_O, "profile")).length).toBe(1); // only HR's earlier row
  });
});

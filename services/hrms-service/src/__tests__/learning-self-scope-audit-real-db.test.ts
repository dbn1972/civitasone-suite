/**
 * W1 SF-16 — learning self-scoping + audit, real-DB round-trip, no mocks.
 *
 *  - GAP-LEARNING-HOME-01: GET /learning/dashboard — only HR may omit
 *    ?employeeId for tenant-wide totals; a manager (or employee) who omits it
 *    gets their OWN counts; a bare employee is forced onto their own record.
 *  - GAP-LEARNING-MY-LEARNING-01: HR/manager reading ANOTHER employee's
 *    enrolments writes an audit row; reading one's own does not.
 *  - GAP-LEARNING-COURSES-DETAIL-02: HR enrolling someone else writes an
 *    audit row in the enrolment's own transaction; a client cannot forge or
 *    suppress the flag; an unlinked caller is rejected (403).
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

registerF3_learning_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "facade00-5f16-4000-8000-000000000a01";
const SEED_ACTOR = "facade00-5f16-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-5f16-4000-8000-0000000000d1";
const DESIG_ID   = "facade00-5f16-4000-8000-0000000000d2";
const EMP_A = "facade00-5f16-4000-8000-0000000000e1"; const A_SUB = "sf16-learning-emp-a";
const EMP_B = "facade00-5f16-4000-8000-0000000000e2"; const B_SUB = "sf16-learning-emp-b";
const EMP_M = "facade00-5f16-4000-8000-0000000000e3"; const M_SUB = "facade00-5f16-4000-8000-0000000000a3";
const COURSE_ID  = "facade00-5f16-4000-8000-0000000000c1";
const COURSE2_ID = "facade00-5f16-4000-8000-0000000000c2";
const COURSE3_ID = "facade00-5f16-4000-8000-0000000000c3";
const B_ENROLMENT = "facade00-5f16-4000-8000-0000000000f1";
const HR_SUB = "facade00-5f16-4000-8000-0000000000a1";
const UNLINKED_SUB = "facade00-5f16-4000-8000-0000000000a2";

const tok = (roles: string[], sub: string): string =>
  signToken({ sub, tid: TENANT, roles, sid: "sess-learning-sf16" }, SECRET);
const bearer = (roles: string[], sub: string): { authorization: string } => ({ authorization: `Bearer ${tok(roles, sub)}` });

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

type AuditRow = { actorId: string; payload: Record<string, unknown> };
async function auditRows(filter: (p: Record<string, unknown>) => boolean): Promise<AuditRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as AuditRow[]).filter((r) => filter(r.payload ?? {}));
}
const readsOf = (target: string, view: string) =>
  auditRows((p) => p.resourceType === "learning_enrollment" && p.action === "read" && p.resourceId === target && p.view === view);
const onBehalf = (target: string) =>
  auditRows((p) => p.action === "enrol_on_behalf" && p.employeeId === target);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
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
    VALUES (${DEPT_ID}, ${TENANT}, 'SF16L', 'SF16 Learning Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'SF16L', 'SF16 Learning Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name, sub] of [[EMP_A, "SF16-A", "SF16 Emp A", A_SUB], [EMP_B, "SF16-B", "SF16 Emp B", B_SUB], [EMP_M, "SF16-M", "SF16 Manager", M_SUB]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${sub}, ${id === EMP_B ? EMP_M : null}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  for (const [id, code] of [[COURSE_ID, "SF16-1"], [COURSE2_ID, "SF16-2"], [COURSE3_ID, "SF16-3"]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
      VALUES (${id}, ${TENANT}, ${code}, ${"Course " + code}, 'general', '2', 'published', ${SEED_ACTOR})`);
  }
  // Victim B: one in-progress enrolment. A and the manager have none.
  await asTenant((tx) => tx`
    INSERT INTO learning.enrollments (id, tenant_id, course_id, employee_id, status, progress_pct)
    VALUES (${B_ENROLMENT}, ${TENANT}, ${COURSE_ID}, ${EMP_B}, 'in_progress', 40)`);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const ZERO = { enrolled: 0, in_progress: 0, completed: 0, overdue: 0, total: 0 };

describe("GET /v1/hrms/learning/dashboard — only HR gets tenant-wide totals (GAP-LEARNING-HOME-01)", () => {
  it("bare employee passing another employee's id gets their OWN (zero) counts, not B's", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard?employeeId=${EMP_B}`, headers: bearer(["employee"], A_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(ZERO);
  });

  it("bare employee omitting employeeId gets their own counts, not tenant totals", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard`, headers: bearer(["employee"], A_SUB) });
    expect(r.json()).toEqual(ZERO);
  });

  it("MANAGER omitting employeeId gets their OWN counts, not tenant totals", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard`, headers: bearer(["manager"], M_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(ZERO);
  });

  it("manager with no linked employee record omitting employeeId gets zeros (fail closed)", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard`, headers: bearer(["manager"], UNLINKED_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(ZERO);
  });

  it("bare employee with no linked record gets zeros (fail closed)", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard?employeeId=${EMP_B}`, headers: bearer(["employee"], UNLINKED_SUB) });
    expect(r.json()).toEqual(ZERO);
  });

  it("HR omitting employeeId still gets tenant-wide totals, with no read audit", async () => {
    const before = (await auditRows((p) => p.view === "dashboard")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard`, headers: bearer(["hr_admin"], HR_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json().in_progress).toBe(1);
    expect(r.json().total).toBe(1);
    await drain();
    expect((await auditRows((p) => p.view === "dashboard")).length).toBe(before);
  });

  it("HR requesting B's counts gets B's figures and an audit row", async () => {
    const before = (await readsOf(EMP_B, "dashboard")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/dashboard?employeeId=${EMP_B}`, headers: bearer(["hr_admin"], HR_SUB) });
    expect(r.json().in_progress).toBe(1);
    await drain();
    const after = await readsOf(EMP_B, "dashboard");
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]!.actorId).toBe(HR_SUB);
  });
});

describe("GET /v1/hrms/learning/my-learning — audit on privileged cross-employee read (GAP-LEARNING-MY-LEARNING-01)", () => {
  it("HR reading B's enrolments gets B's rows AND an audit row naming HR and B", async () => {
    const before = (await readsOf(EMP_B, "my-learning")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`, headers: bearer(["hr_admin"], HR_SUB) });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ employeeId: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.employeeId).toBe(EMP_B);
    await drain();
    const after = await readsOf(EMP_B, "my-learning");
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]!.actorId).toBe(HR_SUB);
  });

  // Owner decision 2 (2026-10-14): a manager reads only direct reports. This
  // test previously had the manager read a NON-report and expect 200; B is now
  // the manager's direct report (see beforeAll) and a non-report is 403.
  it("manager reading a non-report's enrolments is refused (403)", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_A}`, headers: bearer(["manager"], M_SUB) });
    expect(r.statusCode).toBe(403);
  });

  it("manager reading a direct report B's enrolments is audited too", async () => {
    const before = (await readsOf(EMP_B, "my-learning")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`, headers: bearer(["manager"], M_SUB) });
    expect(r.statusCode).toBe(200);
    await drain();
    expect((await readsOf(EMP_B, "my-learning")).length).toBe(before + 1);
  });

  it("manager omitting employeeId reads their OWN enrolments (empty), with no audit row", async () => {
    const before = (await auditRows((p) => p.view === "my-learning")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning`, headers: bearer(["manager"], M_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
    await drain();
    expect((await auditRows((p) => p.view === "my-learning")).length).toBe(before);
  });

  it("bare employee requesting B's id is served their own rows and is NOT audited as a cross-read", async () => {
    const before = (await readsOf(EMP_B, "my-learning")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`, headers: bearer(["employee"], A_SUB) });
    expect((r.json() as unknown[]).length).toBe(0);
    await drain();
    expect((await readsOf(EMP_B, "my-learning")).length).toBe(before);
  });

  it("an unlinked bare employee gets [] (fail closed)", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP_B}`, headers: bearer(["employee"], UNLINKED_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });
});

describe("GET /v1/hrms/learning/enrollments/:id — IDOR + audit", () => {
  it("bare employee A requesting B's enrolment id gets 404", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/enrollments/${B_ENROLMENT}`, headers: bearer(["employee"], A_SUB) });
    expect(r.statusCode).toBe(404);
  });

  it("HR gets B's enrolment and an audit row", async () => {
    const before = (await readsOf(EMP_B, "enrollment")).length;
    const r = await app.inject({ method: "GET", url: `/v1/hrms/learning/enrollments/${B_ENROLMENT}`, headers: bearer(["hr_admin"], HR_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json().employeeId).toBe(EMP_B);
    await drain();
    expect((await readsOf(EMP_B, "enrollment")).length).toBe(before + 1);
  });
});

describe("POST /v1/hrms/learning/courses/:id/enroll — audit on enrol-on-behalf (GAP-LEARNING-COURSES-DETAIL-02)", () => {
  it("HR enrolling B writes the enrolment AND an enrol_on_behalf audit row for B / HR actor", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/learning/courses/${COURSE2_ID}/enroll`,
      headers: bearer(["hr_admin"], HR_SUB), payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const enrol = await asTenant((tx) => tx`SELECT id FROM learning.enrollments WHERE tenant_id = ${TENANT} AND course_id = ${COURSE2_ID} AND employee_id = ${EMP_B}`);
    expect(enrol.length).toBe(1);
    const rows = await onBehalf(EMP_B);
    expect(rows.length).toBe(1);
    expect(rows[0]!.actorId).toBe(HR_SUB);
    expect(rows[0]!.payload.courseId).toBe(COURSE2_ID);
    expect(rows[0]!.payload.resourceId).toBe(enrol[0]!.id);
  });

  it("employee A enrolling with B's id and a forged enrolledOnBehalf flag is enrolled as SELF with no on-behalf audit", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/learning/courses/${COURSE3_ID}/enroll`,
      headers: bearer(["employee"], A_SUB), payload: { employeeId: EMP_B, enrolledOnBehalf: true },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    const rows = await asTenant((tx) => tx`SELECT employee_id FROM learning.enrollments WHERE tenant_id = ${TENANT} AND course_id = ${COURSE3_ID}`);
    expect(rows.map((x) => x.employee_id)).toEqual([EMP_A]);
    expect((await onBehalf(EMP_A)).length).toBe(0);
    expect((await onBehalf(EMP_B)).length).toBe(1); // still only HR's earlier row
  });

  it("an unlinked non-HR caller is rejected with 403 and nothing is written", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/learning/courses/${COURSE3_ID}/enroll`,
      headers: bearer(["employee"], UNLINKED_SUB), payload: { employeeId: EMP_B },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NO_EMPLOYEE_LINK");
  });
});

/**
 * SVC-121/122/124 — FORCE RLS proof. Connects DIRECTLY as the runtime role
 * (hrms_svc, NOBYPASSRLS non-superuser), sets the app.tenant_id GUC, and asserts
 * tenant A cannot read tenant B's rows across the new training-admin, learning
 * and competency tables. Proves the 0046 policies are enforced at the database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const TA = randomUUID();
const TB = randomUUID();
const tag = randomUUID().slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;

interface Seed { sessionId: string; courseId: string; enrollmentId: string; empCompId: string; }

async function setTenant(t: string) { await sql`select set_config('app.tenant_id', ${t}, false)`; }

async function seed(tenant: string, label: string): Promise<Seed> {
  await setTenant(tenant);
  const trainingId = randomUUID();
  const sessionId = randomUUID();
  const courseId = randomUUID();
  const enrollmentId = randomUUID();
  const empCompId = randomUUID();
  const frameworkId = randomUUID();
  const competencyId = randomUUID();

  await sql`insert into training.hrms_trainings (id, tenant_id, title, from_date, to_date, created_by, updated_by)
            values (${trainingId}::uuid, ${tenant}::uuid, ${"T " + label}, '2026-01-01', '2026-01-02', ${tenant}::uuid, ${tenant}::uuid)`;
  await sql`insert into training.hrms_training_sessions (id, tenant_id, training_id, title, session_date, created_by, updated_by)
            values (${sessionId}::uuid, ${tenant}::uuid, ${trainingId}::uuid, ${"S " + label}, '2026-01-01', ${tenant}::uuid, ${tenant}::uuid)`;
  await sql`insert into learning.courses (id, tenant_id, code, title, created_by)
            values (${courseId}::uuid, ${tenant}::uuid, ${"C-" + tag + "-" + label}, ${"Course " + label}, ${tenant}::uuid)`;
  await sql`insert into learning.enrollments (id, tenant_id, course_id, employee_id)
            values (${enrollmentId}::uuid, ${tenant}::uuid, ${courseId}::uuid, ${tenant}::uuid)`;
  await sql`insert into competency.frameworks (id, tenant_id, name, created_by)
            values (${frameworkId}::uuid, ${tenant}::uuid, ${"FW " + label}, ${tenant}::uuid)`;
  await sql`insert into competency.competencies (id, tenant_id, framework_id, code, name)
            values (${competencyId}::uuid, ${tenant}::uuid, ${frameworkId}::uuid, ${"K-" + tag + "-" + label}, ${"Comp " + label})`;
  await sql`insert into competency.employee_competencies (id, tenant_id, employee_id, competency_id, current_level)
            values (${empCompId}::uuid, ${tenant}::uuid, ${tenant}::uuid, ${competencyId}::uuid, 3)`;
  return { sessionId, courseId, enrollmentId, empCompId };
}

let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  seedA = await seed(TA, "A");
  seedB = await seed(TB, "B");
});
afterAll(async () => { await sql.end(); });

describe("learning/competency RLS — direct non-superuser role", () => {
  it("runs as a NOBYPASSRLS non-superuser role", async () => {
    const rows = await sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });

  it("tenant A cannot read tenant B's training sessions", async () => {
    await setTenant(TA);
    expect((await sql`select id from training.hrms_training_sessions where id = ${seedA.sessionId}::uuid`).length).toBe(1);
    expect((await sql`select id from training.hrms_training_sessions where id = ${seedB.sessionId}::uuid`).length).toBe(0);
    expect((await sql`select count(*)::int as n from training.hrms_training_sessions where tenant_id = ${TB}::uuid`)[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's courses or enrolments", async () => {
    await setTenant(TA);
    expect((await sql`select id from learning.courses where id = ${seedB.courseId}::uuid`).length).toBe(0);
    expect((await sql`select id from learning.enrollments where id = ${seedB.enrollmentId}::uuid`).length).toBe(0);
    expect((await sql`select count(*)::int as n from learning.enrollments where tenant_id = ${TB}::uuid`)[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's employee competencies", async () => {
    await setTenant(TA);
    expect((await sql`select id from competency.employee_competencies where id = ${seedB.empCompId}::uuid`).length).toBe(0);
    expect((await sql`select count(*)::int as n from competency.employee_competencies where tenant_id = ${TB}::uuid`)[0].n).toBe(0);
    // sanity: A sees its own
    expect((await sql`select id from competency.employee_competencies where id = ${seedA.empCompId}::uuid`).length).toBe(1);
  });

  it("tenant B sees B's rows but not A's (symmetry)", async () => {
    await setTenant(TB);
    expect((await sql`select id from learning.courses where id = ${seedB.courseId}::uuid`).length).toBe(1);
    expect((await sql`select id from learning.courses where id = ${seedA.courseId}::uuid`).length).toBe(0);
  });
});

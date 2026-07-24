/**
 * Assessment & Certification — FORCE RLS proof (SVC-123).
 *
 * Connects DIRECTLY as the runtime role (hrms_svc, NOBYPASSRLS non-superuser),
 * sets the app.tenant_id GUC, and asserts tenant A cannot read tenant B's rows
 * across assessments, attempts and certificates. This proves the RLS policies
 * added in 0044 are enforced at the database, not merely by app-layer WHEREs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const TA = randomUUID();
const TB = randomUUID();
const run = randomUUID().slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;

interface Seed { bankId: string; assessmentId: string; attemptId: string; certToken: string; }

async function setTenant(tenant: string) {
  await sql`select set_config('app.tenant_id', ${tenant}, false)`;
}

async function seedTenant(tenant: string, tag: string): Promise<Seed> {
  await setTenant(tenant);
  const bankId = randomUUID();
  const assessmentId = randomUUID();
  const attemptId = randomUUID();
  const certToken = `tok-${tag}-${run}-${randomUUID().replace(/-/g, "")}`.slice(0, 60);
  await sql`insert into assessment.question_banks (id, tenant_id, title, created_by)
            values (${bankId}::uuid, ${tenant}::uuid, ${"Bank " + tag}, ${tenant}::uuid)`;
  await sql`insert into assessment.assessments (id, tenant_id, title, bank_id, passing_score, created_by)
            values (${assessmentId}::uuid, ${tenant}::uuid, ${"Assessment " + tag}, ${bankId}::uuid, 10, ${tenant}::uuid)`;
  await sql`insert into assessment.attempts (id, tenant_id, assessment_id, employee_id, attempt_no)
            values (${attemptId}::uuid, ${tenant}::uuid, ${assessmentId}::uuid, ${tenant}::uuid, 1)`;
  await sql`insert into assessment.certificates (id, tenant_id, assessment_id, attempt_id, employee_id, certificate_no, verify_token)
            values (${randomUUID()}::uuid, ${tenant}::uuid, ${assessmentId}::uuid, ${attemptId}::uuid, ${tenant}::uuid, ${"CERT-" + tag + "-" + run}, ${certToken})`;
  return { bankId, assessmentId, attemptId, certToken };
}

let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  seedA = await seedTenant(TA, "A");
  seedB = await seedTenant(TB, "B");
});

afterAll(async () => {
  await sql.end();
});

describe("assessment RLS — direct non-superuser role", () => {
  it("runs as a NOBYPASSRLS non-superuser role", async () => {
    const rows = await sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });

  it("tenant A cannot read tenant B's assessment rows", async () => {
    await setTenant(TA);
    const own = await sql`select id from assessment.assessments where id = ${seedA.assessmentId}::uuid`;
    expect(own.length).toBe(1); // A sees its own
    const foreign = await sql`select id from assessment.assessments where id = ${seedB.assessmentId}::uuid`;
    expect(foreign.length).toBe(0); // B's row invisible
    const anyB = await sql`select count(*)::int as n from assessment.assessments where tenant_id = ${TB}::uuid`;
    expect(anyB[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's attempt rows", async () => {
    await setTenant(TA);
    const foreign = await sql`select id from assessment.attempts where id = ${seedB.attemptId}::uuid`;
    expect(foreign.length).toBe(0);
    const anyB = await sql`select count(*)::int as n from assessment.attempts where tenant_id = ${TB}::uuid`;
    expect(anyB[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's certificate rows (even by verify token)", async () => {
    await setTenant(TA);
    const byToken = await sql`select id from assessment.certificates where verify_token = ${seedB.certToken}`;
    expect(byToken.length).toBe(0);
    const anyB = await sql`select count(*)::int as n from assessment.certificates where tenant_id = ${TB}::uuid`;
    expect(anyB[0].n).toBe(0);
    // sanity: A can still see its own certificate by its token
    const own = await sql`select id from assessment.certificates where verify_token = ${seedA.certToken}`;
    expect(own.length).toBe(1);
  });

  it("tenant B sees B's rows but not A's (symmetry)", async () => {
    await setTenant(TB);
    const ownB = await sql`select id from assessment.assessments where id = ${seedB.assessmentId}::uuid`;
    expect(ownB.length).toBe(1);
    const foreignA = await sql`select id from assessment.assessments where id = ${seedA.assessmentId}::uuid`;
    expect(foreignA.length).toBe(0);
  });
});

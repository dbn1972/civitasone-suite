/**
 * Manpower Planning — FORCE RLS proof (SVC-003).
 *
 * Connects DIRECTLY as the runtime role (hrms_svc, NOBYPASSRLS non-superuser),
 * sets the app.tenant_id GUC, and asserts tenant A cannot read tenant B's rows
 * across manpower.plans and manpower.requisitions. Proves the RLS policies added
 * in 0062 are enforced at the database, not merely by an app-layer WHERE.
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

interface Seed { planId: string; requisitionId: string; }

async function setTenant(tenant: string) {
  await sql`select set_config('app.tenant_id', ${tenant}, false)`;
}

async function seedTenant(tenant: string, tag: string): Promise<Seed> {
  await setTenant(tenant);
  const planId = randomUUID();
  const requisitionId = randomUUID();
  await sql`insert into manpower.plans (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, created_by)
            values (${planId}::uuid, ${tenant}::uuid, 2027, ${randomUUID()}::uuid, ${"Cadre " + tag}, 10, ${tenant}::uuid)`;
  await sql`insert into manpower.requisitions (id, tenant_id, plan_id, requisition_no, unit_id, cadre, requested_vacancies, job_opening_id, created_by)
            values (${requisitionId}::uuid, ${tenant}::uuid, ${planId}::uuid, ${"REQ-" + tag + "-" + run}, ${randomUUID()}::uuid, ${"Cadre " + tag}, 10, ${randomUUID()}::uuid, ${tenant}::uuid)`;
  return { planId, requisitionId };
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

describe("manpower RLS — direct non-superuser role", () => {
  it("runs as a NOBYPASSRLS non-superuser role", async () => {
    const rows = await sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });

  it("tenant A cannot read tenant B's plan rows", async () => {
    await setTenant(TA);
    const own = await sql`select id from manpower.plans where id = ${seedA.planId}::uuid`;
    expect(own.length).toBe(1);
    const foreign = await sql`select id from manpower.plans where id = ${seedB.planId}::uuid`;
    expect(foreign.length).toBe(0);
    const anyB = await sql`select count(*)::int as n from manpower.plans where tenant_id = ${TB}::uuid`;
    expect(anyB[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's requisition rows", async () => {
    await setTenant(TA);
    const foreign = await sql`select id from manpower.requisitions where id = ${seedB.requisitionId}::uuid`;
    expect(foreign.length).toBe(0);
    const anyB = await sql`select count(*)::int as n from manpower.requisitions where tenant_id = ${TB}::uuid`;
    expect(anyB[0].n).toBe(0);
  });

  it("tenant B sees B's rows but not A's (symmetry)", async () => {
    await setTenant(TB);
    const ownB = await sql`select id from manpower.plans where id = ${seedB.planId}::uuid`;
    expect(ownB.length).toBe(1);
    const foreignA = await sql`select id from manpower.plans where id = ${seedA.planId}::uuid`;
    expect(foreignA.length).toBe(0);
  });
});

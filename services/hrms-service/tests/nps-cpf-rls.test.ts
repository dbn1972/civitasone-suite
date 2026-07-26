/**
 * NPS + CPF — FORCE RLS proof (SVC-018).
 *
 * Connects DIRECTLY as the runtime role (hrms_svc, NOBYPASSRLS non-superuser),
 * sets the app.tenant_id GUC and asserts tenant A cannot read tenant B's rows
 * across nps.hrms_nps_accounts / nps.hrms_nps_contributions and
 * cpf.hrms_cpf_accounts / cpf.hrms_cpf_ledger. Proves the policies added in
 * 0063 are enforced at the database, not merely by an app-layer WHERE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const TA = randomUUID();
const TB = randomUUID();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;

interface Seed { npsAcct: string; npsContrib: string; cpfAcct: string; cpfLedger: string; }

async function setTenant(tenant: string) {
  await sql`select set_config('app.tenant_id', ${tenant}, false)`;
}

async function seedTenant(tenant: string, tag: string): Promise<Seed> {
  await setTenant(tenant);
  const emp = randomUUID();
  const npsAcct = randomUUID();
  const npsContrib = randomUUID();
  const cpfAcct = randomUUID();
  const cpfLedger = randomUUID();
  await sql`insert into nps.hrms_nps_accounts (id, tenant_id, employee_id, pran, created_by, updated_by)
            values (${npsAcct}::uuid, ${tenant}::uuid, ${emp}::uuid, ${"PRAN-" + tag}, ${tenant}::uuid, ${tenant}::uuid)`;
  await sql`insert into nps.hrms_nps_contributions
            (id, tenant_id, account_id, employee_id, entry_type, period, emp_amount_minor, er_amount_minor, delta_minor, emp_balance_minor, er_balance_minor, balance_minor, created_by)
            values (${npsContrib}::uuid, ${tenant}::uuid, ${npsAcct}::uuid, ${emp}::uuid, 'contribution', '2026-04', 100, 140, 240, 100, 140, 240, ${tenant}::uuid)`;
  await sql`insert into cpf.hrms_cpf_accounts (id, tenant_id, employee_id, cpf_number, created_by, updated_by)
            values (${cpfAcct}::uuid, ${tenant}::uuid, ${emp}::uuid, ${"CPF-" + tag}, ${tenant}::uuid, ${tenant}::uuid)`;
  await sql`insert into cpf.hrms_cpf_ledger
            (id, tenant_id, account_id, employee_id, entry_type, emp_amount_minor, er_amount_minor, delta_minor, emp_balance_minor, er_balance_minor, balance_minor, created_by)
            values (${cpfLedger}::uuid, ${tenant}::uuid, ${cpfAcct}::uuid, ${emp}::uuid, 'subscription', 100, 100, 200, 100, 100, 200, ${tenant}::uuid)`;
  return { npsAcct, npsContrib, cpfAcct, cpfLedger };
}

let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  seedA = await seedTenant(TA, "A");
  seedB = await seedTenant(TB, "B");
});

afterAll(async () => {
  // best-effort cleanup within each tenant scope
  for (const [t, s] of [[TA, seedA], [TB, seedB]] as [string, Seed][]) {
    await setTenant(t);
    await sql`delete from nps.hrms_nps_contributions where id = ${s.npsContrib}::uuid`;
    await sql`delete from nps.hrms_nps_accounts where id = ${s.npsAcct}::uuid`;
    await sql`delete from cpf.hrms_cpf_ledger where id = ${s.cpfLedger}::uuid`;
    await sql`delete from cpf.hrms_cpf_accounts where id = ${s.cpfAcct}::uuid`;
  }
  await sql.end();
});

describe("NPS/CPF RLS — direct non-superuser role", () => {
  it("runs as a NOBYPASSRLS non-superuser role", async () => {
    const rows = await sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });

  it("tenant A cannot read tenant B's NPS account or contribution rows", async () => {
    await setTenant(TA);
    expect((await sql`select id from nps.hrms_nps_accounts where id = ${seedA.npsAcct}::uuid`).length).toBe(1);
    expect((await sql`select id from nps.hrms_nps_accounts where id = ${seedB.npsAcct}::uuid`).length).toBe(0);
    expect((await sql`select id from nps.hrms_nps_contributions where id = ${seedB.npsContrib}::uuid`).length).toBe(0);
    expect((await sql`select count(*)::int as n from nps.hrms_nps_accounts where tenant_id = ${TB}::uuid`)[0].n).toBe(0);
  });

  it("tenant A cannot read tenant B's CPF account or ledger rows", async () => {
    await setTenant(TA);
    expect((await sql`select id from cpf.hrms_cpf_accounts where id = ${seedA.cpfAcct}::uuid`).length).toBe(1);
    expect((await sql`select id from cpf.hrms_cpf_accounts where id = ${seedB.cpfAcct}::uuid`).length).toBe(0);
    expect((await sql`select id from cpf.hrms_cpf_ledger where id = ${seedB.cpfLedger}::uuid`).length).toBe(0);
    expect((await sql`select count(*)::int as n from cpf.hrms_cpf_ledger where tenant_id = ${TB}::uuid`)[0].n).toBe(0);
  });

  it("tenant B sees B's rows but not A's (symmetry)", async () => {
    await setTenant(TB);
    expect((await sql`select id from nps.hrms_nps_accounts where id = ${seedB.npsAcct}::uuid`).length).toBe(1);
    expect((await sql`select id from nps.hrms_nps_accounts where id = ${seedA.npsAcct}::uuid`).length).toBe(0);
    expect((await sql`select id from cpf.hrms_cpf_accounts where id = ${seedA.cpfAcct}::uuid`).length).toBe(0);
  });

  it("WITH CHECK blocks writing a row for another tenant", async () => {
    await setTenant(TA);
    await expect(
      sql`insert into nps.hrms_nps_accounts (id, tenant_id, employee_id, pran, created_by, updated_by)
          values (${randomUUID()}::uuid, ${TB}::uuid, ${randomUUID()}::uuid, 'X', ${TA}::uuid, ${TA}::uuid)`,
    ).rejects.toThrow();
  });
});

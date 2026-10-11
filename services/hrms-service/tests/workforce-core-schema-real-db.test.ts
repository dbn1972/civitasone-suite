/**
 * Workforce Core schema — real-Postgres proof (SmartTransfer OS, ST-M01-07).
 *
 * Connects DIRECTLY as the runtime role (hrms_svc, NOBYPASSRLS non-superuser),
 * sets the app.tenant_id GUC per the service convention, and proves:
 *   1. the role is genuinely NOBYPASSRLS (so RLS actually applies);
 *   2. FORCE RLS cross-tenant isolation on EVERY new table (A cannot see B);
 *   3. the substantive-occupancy EXCLUDE constraints:
 *        a. a second substantive holder on the same post (overlapping) is rejected;
 *        b. an ADJACENT substantive range (half-open [) — one ends the day the
 *           next starts) is ALLOWED;
 *        c. a non-substantive (acting) overlap is ALLOWED;
 *        d. the SAME employee substantively in two posts at once is rejected;
 *   4. tenure computation from the append-only posting ledger
 *      (service_tenure_days / current_station_tenure_days / v_current_posting).
 *
 * Mirrors tests/manpower-rls.test.ts: a direct postgres-js client as hrms_svc,
 * app.tenant_id via set_config, random tenants so parallel runs never collide.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const TA = randomUUID();
const TB = randomUUID();
const tag = randomUUID().slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;

async function setTenant(tenant: string) {
  await sql`select set_config('app.tenant_id', ${tenant}, false)`;
}

interface Seed {
  cadreId: string;
  empCadreId: string;
  postId: string;
  occId: string;
  ledgerId: string;
  employeeId: string;
}

async function seedTenant(tenant: string, label: string): Promise<Seed> {
  await setTenant(tenant);
  const cadreId = randomUUID();
  const employeeId = randomUUID();
  const empCadreId = randomUUID();
  const postId = randomUUID();
  const occId = randomUUID();
  const ledgerId = randomUUID();
  const officeId = randomUUID();

  await sql`insert into workforce_core.cadre (id, tenant_id, code, name)
            values (${cadreId}::uuid, ${tenant}::uuid, ${"CADRE-" + label + "-" + tag}, ${"Cadre " + label})`;
  await sql`insert into workforce_core.employee_cadre (id, tenant_id, employee_id, cadre_id, seniority_date)
            values (${empCadreId}::uuid, ${tenant}::uuid, ${employeeId}::uuid, ${cadreId}::uuid, '2020-01-01')`;
  await sql`insert into workforce_core.post (id, tenant_id, post_no, office_id, cadre_id)
            values (${postId}::uuid, ${tenant}::uuid, ${"POST-" + label + "-" + tag}, ${officeId}::uuid, ${cadreId}::uuid)`;
  await sql`insert into workforce_core.post_occupancy (id, tenant_id, post_id, employee_id, charge_type, effective_from)
            values (${occId}::uuid, ${tenant}::uuid, ${postId}::uuid, ${employeeId}::uuid, 'substantive', '2020-01-01')`;
  await sql`insert into workforce_core.posting_ledger (id, tenant_id, employee_id, office_id, post_id, charge_type, effective_from, effective_to)
            values (${ledgerId}::uuid, ${tenant}::uuid, ${employeeId}::uuid, ${officeId}::uuid, ${postId}::uuid, 'substantive', '2020-01-01', '2022-12-31')`;

  return { cadreId, empCadreId, postId, occId, ledgerId, employeeId };
}

let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  seedA = await seedTenant(TA, "A");
  seedB = await seedTenant(TB, "B");
});

afterAll(async () => {
  // Best-effort cleanup of this run's rows. posting_ledger is append-only (a
  // trigger rejects DELETE), so ledger rows — and the post/cadre rows they
  // reference — are intentionally left; they sit under random tenant ids that
  // no other test or tenant can see.
  try {
    for (const t of [TA, TB]) {
      await setTenant(t);
      await sql`delete from workforce_core.post_occupancy where tenant_id = ${t}::uuid`;
      await sql`delete from workforce_core.employee_cadre where tenant_id = ${t}::uuid`;
      await sql`delete from workforce_core.post p where p.tenant_id = ${t}::uuid
                and not exists (select 1 from workforce_core.posting_ledger l where l.post_id = p.id)`;
      await sql`delete from workforce_core.cadre c where c.tenant_id = ${t}::uuid
                and not exists (select 1 from workforce_core.post p where p.cadre_id = c.id)
                and not exists (select 1 from workforce_core.employee_cadre e where e.cadre_id = c.id)`;
    }
  } finally {
    await sql.end();
  }
});

describe("workforce_core — runtime role & RLS", () => {
  it("runs as the NOBYPASSRLS hrms_svc role", async () => {
    const rows = await sql`select current_user as u,
      (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });

  const tables: Array<{ tbl: string; idOf: (s: Seed) => string }> = [
    { tbl: "workforce_core.cadre", idOf: (s) => s.cadreId },
    { tbl: "workforce_core.employee_cadre", idOf: (s) => s.empCadreId },
    { tbl: "workforce_core.post", idOf: (s) => s.postId },
    { tbl: "workforce_core.post_occupancy", idOf: (s) => s.occId },
    { tbl: "workforce_core.posting_ledger", idOf: (s) => s.ledgerId },
  ];

  for (const { tbl, idOf } of tables) {
    it(`${tbl}: tenant A cannot read tenant B's rows (FORCE RLS)`, async () => {
      await setTenant(TA);
      const own = await sql.unsafe(`select id from ${tbl} where id = $1::uuid`, [idOf(seedA)]);
      expect(own.length).toBe(1);
      const foreign = await sql.unsafe(`select id from ${tbl} where id = $1::uuid`, [idOf(seedB)]);
      expect(foreign.length).toBe(0);
      const anyB = await sql.unsafe(`select count(*)::int as n from ${tbl} where tenant_id = $1::uuid`, [TB]);
      expect(anyB[0].n).toBe(0);
    });
  }

  it("symmetry: tenant B sees B's cadre but not A's", async () => {
    await setTenant(TB);
    const ownB = await sql`select id from workforce_core.cadre where id = ${seedB.cadreId}::uuid`;
    expect(ownB.length).toBe(1);
    const foreignA = await sql`select id from workforce_core.cadre where id = ${seedA.cadreId}::uuid`;
    expect(foreignA.length).toBe(0);
  });

  it("a cross-tenant write is rejected by WITH CHECK", async () => {
    await setTenant(TA);
    // insert a cadre row claiming tenant B while scoped to A -> policy WITH CHECK fails
    await expect(
      sql`insert into workforce_core.cadre (id, tenant_id, code, name)
          values (${randomUUID()}::uuid, ${TB}::uuid, ${"X-" + tag}, 'cross tenant')`,
    ).rejects.toThrow();
  });
});

describe("workforce_core — substantive occupancy invariant", () => {
  it("rejects a SECOND substantive holder on the same post (overlapping)", async () => {
    await setTenant(TA);
    await expect(
      sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
          values (${TA}::uuid, ${seedA.postId}::uuid, ${randomUUID()}::uuid, 'substantive', '2021-06-01')`,
    ).rejects.toThrow(/post_occupancy_one_substantive_per_post/);
  });

  it("allows an ACTING holder on the same post over the same period", async () => {
    await setTenant(TA);
    const rows = await sql`insert into workforce_core.post_occupancy
        (tenant_id, post_id, employee_id, charge_type, effective_from)
        values (${TA}::uuid, ${seedA.postId}::uuid, ${randomUUID()}::uuid, 'acting', '2021-06-01')
        returning id`;
    expect(rows.length).toBe(1);
  });

  it("allows an ADJACENT substantive range after the incumbent is closed", async () => {
    await setTenant(TA);
    const post = randomUUID();
    const office = randomUUID();
    const e1 = randomUUID();
    const e2 = randomUUID();
    await sql`insert into workforce_core.post (id, tenant_id, post_no, office_id)
              values (${post}::uuid, ${TA}::uuid, ${"POST-ADJ-" + tag}, ${office}::uuid)`;
    await sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from, effective_to)
              values (${TA}::uuid, ${post}::uuid, ${e1}::uuid, 'substantive', '2020-01-01', '2022-12-31')`;
    // next holder starts exactly on the previous end date; half-open [) => no overlap
    const rows = await sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
              values (${TA}::uuid, ${post}::uuid, ${e2}::uuid, 'substantive', '2022-12-31')
              returning id`;
    expect(rows.length).toBe(1);
  });

  it("rejects the same employee substantive in two posts at the same time", async () => {
    await setTenant(TA);
    const office = randomUUID();
    const emp = randomUUID();
    const postX = randomUUID();
    const postY = randomUUID();
    await sql`insert into workforce_core.post (id, tenant_id, post_no, office_id)
              values (${postX}::uuid, ${TA}::uuid, ${"POST-X-" + tag}, ${office}::uuid)`;
    await sql`insert into workforce_core.post (id, tenant_id, post_no, office_id)
              values (${postY}::uuid, ${TA}::uuid, ${"POST-Y-" + tag}, ${office}::uuid)`;
    await sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
              values (${TA}::uuid, ${postX}::uuid, ${emp}::uuid, 'substantive', '2023-01-01')`;
    await expect(
      sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
          values (${TA}::uuid, ${postY}::uuid, ${emp}::uuid, 'substantive', '2023-06-01')`,
    ).rejects.toThrow(/post_occupancy_one_substantive_per_emp/);
  });
});

describe("workforce_core — tenure from the posting ledger", () => {
  it("service_tenure_days sums substantive spans inclusively", async () => {
    await setTenant(TA);
    // seedA ledger: 2020-01-01..2022-12-31 substantive = 1096 days (incl 2020 leap day)
    const rows = await sql`select workforce_core.service_tenure_days(${seedA.employeeId}::uuid, '2023-12-31'::date) as d`;
    expect(rows[0].d).toBe(1096);
  });

  it("current_station_tenure_days bounds the running span at as_of", async () => {
    await setTenant(TA);
    const rows = await sql`select workforce_core.current_station_tenure_days(${seedA.employeeId}::uuid, '2021-01-01'::date) as d`;
    expect(rows[0].d).toBe(367); // 2020-01-01..2021-01-01 inclusive (leap year)
  });

  it("v_current_posting returns the latest substantive posting, tenant-scoped", async () => {
    await setTenant(TA);
    const rows = await sql`select employee_id, office_id, post_id
                             from workforce_core.v_current_posting
                            where employee_id = ${seedA.employeeId}::uuid`;
    expect(rows.length).toBe(1);
    expect(rows[0].post_id).toBe(seedA.postId);
    // tenant B cannot see A's current posting through the view
    await setTenant(TB);
    const foreign = await sql`select employee_id from workforce_core.v_current_posting
                               where employee_id = ${seedA.employeeId}::uuid`;
    expect(foreign.length).toBe(0);
  });

  it("tenure is zero for an employee with no ledger history", async () => {
    await setTenant(TA);
    const rows = await sql`select workforce_core.service_tenure_days(${randomUUID()}::uuid, '2023-12-31'::date) as d`;
    expect(rows[0].d).toBe(0);
  });
});

describe("workforce_core — tenure never double-counts a day", () => {
  async function ledgerRow(emp: string, from: string, to: string | null, charge = "substantive") {
    await sql`insert into workforce_core.posting_ledger (tenant_id, employee_id, office_id, charge_type, effective_from, effective_to)
              values (${TA}::uuid, ${emp}::uuid, ${randomUUID()}::uuid, ${charge}, ${from}::date, ${to}::date)`;
  }
  const tenure = async (emp: string, asOf: string) =>
    (await sql`select workforce_core.service_tenure_days(${emp}::uuid, ${asOf}::date) as d`)[0].d;

  it("a transfer (old span ends the day the new one begins) counts that day once", async () => {
    await setTenant(TA);
    const emp = randomUUID();
    await ledgerRow(emp, "2020-01-01", "2020-01-31");
    await ledgerRow(emp, "2020-01-31", null);
    expect(await tenure(emp, "2020-02-01")).toBe(32); // Jan 1..Feb 1 inclusive
  });

  it("a span nested inside another adds nothing", async () => {
    await setTenant(TA);
    const emp = randomUUID();
    await ledgerRow(emp, "2020-01-01", "2020-01-31");
    await ledgerRow(emp, "2020-01-31", null);
    await ledgerRow(emp, "2020-01-15", "2020-01-20");
    expect(await tenure(emp, "2020-02-01")).toBe(32);
  });

  it("disjoint spans still sum and non-substantive charge is ignored", async () => {
    await setTenant(TA);
    const emp = randomUUID();
    await ledgerRow(emp, "2020-01-01", "2020-01-10"); // 10
    await ledgerRow(emp, "2020-02-01", "2020-02-05"); // 5
    await ledgerRow(emp, "2020-01-01", "2020-12-31", "acting");
    expect(await tenure(emp, "2020-12-31")).toBe(15);
  });

  it("spans starting after as_of are excluded and open spans stop at as_of", async () => {
    await setTenant(TA);
    const emp = randomUUID();
    await ledgerRow(emp, "2020-01-01", null);
    await ledgerRow(emp, "2021-01-01", "2021-01-31");
    expect(await tenure(emp, "2020-01-10")).toBe(10);
  });
});

describe("workforce_core — posting_ledger is append-only", () => {
  async function fresh(open = true) {
    await setTenant(TA);
    const id = randomUUID();
    await sql`insert into workforce_core.posting_ledger (id, tenant_id, employee_id, office_id, charge_type, effective_from, effective_to)
              values (${id}::uuid, ${TA}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, 'substantive', '2024-01-01',
                      ${open ? null : "2024-06-01"}::date)`;
    return id;
  }

  it("rejects DELETE", async () => {
    const id = await fresh();
    await expect(sql`delete from workforce_core.posting_ledger where id = ${id}::uuid`).rejects.toThrow(/append-only/);
    const rows = await sql`select id from workforce_core.posting_ledger where id = ${id}::uuid`;
    expect(rows.length).toBe(1);
  });

  it("rejects rewriting history (office, dates of a closed span, order_ref)", async () => {
    const closed = await fresh(false);
    await expect(
      sql`update workforce_core.posting_ledger set effective_to = '2024-09-01' where id = ${closed}::uuid`,
    ).rejects.toThrow(/append-only/);
    const open = await fresh();
    await expect(
      sql`update workforce_core.posting_ledger set office_id = ${randomUUID()}::uuid where id = ${open}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`update workforce_core.posting_ledger set effective_from = '2023-01-01' where id = ${open}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`update workforce_core.posting_ledger set order_ref = 'X' where id = ${open}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("allows the one sanctioned mutation: closing an open span", async () => {
    const open = await fresh();
    const rows = await sql`update workforce_core.posting_ledger
                              set effective_to = '2024-03-01', version = version + 1
                            where id = ${open}::uuid returning effective_to, version`;
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(2);
  });
});

describe("workforce_core — empty occupancy range cannot bypass the EXCLUDE constraints", () => {
  it("rejects effective_to = effective_from", async () => {
    await setTenant(TA);
    await expect(
      sql`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from, effective_to)
          values (${TA}::uuid, ${seedA.postId}::uuid, ${randomUUID()}::uuid, 'substantive', '2021-06-01', '2021-06-01')`,
    ).rejects.toThrow(/post_occupancy_dates_check/);
  });
});

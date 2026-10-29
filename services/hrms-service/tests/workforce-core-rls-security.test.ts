/**
 * Workforce Core — RLS security proof (SmartTransfer OS, ST-M01-15, part b).
 *
 * Spec §14 (RLS; cross-tenant leakage testing). D-ST-01/02/03/23 (Workforce
 * Core owns these tables). This is the SECURITY-focused companion to
 * tests/workforce-core-schema-real-db.test.ts: it asserts the RLS POSTURE
 * directly from the catalog and proves cross-tenant isolation for EVERY new
 * workforce_core table, from the runtime (NOBYPASSRLS) role.
 *
 * Proven here:
 *   1. the test runs as the real NOBYPASSRLS runtime role (so RLS applies);
 *   2. for every workforce_core table: relrowsecurity AND relforcerowsecurity
 *      are TRUE in pg_class (FORCE RLS, not just ENABLE — the house rule) and a
 *      tenant_isolation policy exists in pg_policies;
 *   3. tenant A cannot READ tenant B's rows in any table;
 *   4. tenant A cannot WRITE a row stamped tenant B (policy WITH CHECK);
 *   5. with NO app.tenant_id set, the fail-closed predicate returns zero rows
 *      (an unset GUC never leaks data).
 *
 * Workforce Core carries NO jurisdiction_unit_id columns and NO list routes
 * (it is the master data behind SmartTransfer), so jurisdiction-scoping is
 * asserted on the SmartTransfer service tables instead (ST-M01-15b, the branch
 * cut from origin/st/m01-12-smarttransfer-service). This file deliberately
 * scopes itself to tenant isolation + FORCE RLS for the workforce_core tables.
 *
 * Mirrors the direct-postgres-js harness of workforce-core-schema-real-db.test.ts
 * (hrms_svc, app.tenant_id via set_config, random tenants for parallel safety).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDbHostPort } from "../../../vitest.testdb";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://hrms_svc:hrms_dev_pw@${testDbHostPort()}/civitas_hrms`;

const TA = randomUUID();
const TB = randomUUID();
const tag = randomUUID().slice(0, 8);

// Every table in the workforce_core schema and the id of the row we seed in it.
interface Seed {
  cadreId: string;
  empCadreId: string;
  postId: string;
  occId: string;
  ledgerId: string;
}

// (table short name, column selector for the seeded id) — the full set of new
// workforce_core tables (ST-M01-07).
const TABLES: Array<{ tbl: string; idOf: (s: Seed) => string }> = [
  { tbl: "cadre", idOf: (s) => s.cadreId },
  { tbl: "employee_cadre", idOf: (s) => s.empCadreId },
  { tbl: "post", idOf: (s) => s.postId },
  { tbl: "post_occupancy", idOf: (s) => s.occId },
  { tbl: "posting_ledger", idOf: (s) => s.ledgerId },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;

async function setTenant(tenant: string) {
  await sql`select set_config('app.tenant_id', ${tenant}, false)`;
}
async function clearTenant() {
  // reset to a blank GUC — the fail-closed predicate must then match nothing.
  await sql`select set_config('app.tenant_id', '', false)`;
}

async function seedTenant(tenant: string, label: string): Promise<Seed> {
  await setTenant(tenant);
  const cadreId = randomUUID();
  const empCadreId = randomUUID();
  const employeeId = randomUUID();
  const postId = randomUUID();
  const occId = randomUUID();
  const ledgerId = randomUUID();
  const officeId = randomUUID();

  await sql`insert into workforce_core.cadre (id, tenant_id, code, name)
            values (${cadreId}::uuid, ${tenant}::uuid, ${"SEC-CADRE-" + label + "-" + tag}, ${"Cadre " + label})`;
  await sql`insert into workforce_core.employee_cadre (id, tenant_id, employee_id, cadre_id, seniority_date)
            values (${empCadreId}::uuid, ${tenant}::uuid, ${employeeId}::uuid, ${cadreId}::uuid, '2020-01-01')`;
  await sql`insert into workforce_core.post (id, tenant_id, post_no, office_id, cadre_id)
            values (${postId}::uuid, ${tenant}::uuid, ${"SEC-POST-" + label + "-" + tag}, ${officeId}::uuid, ${cadreId}::uuid)`;
  await sql`insert into workforce_core.post_occupancy (id, tenant_id, post_id, employee_id, charge_type, effective_from)
            values (${occId}::uuid, ${tenant}::uuid, ${postId}::uuid, ${employeeId}::uuid, 'substantive', '2020-01-01')`;
  await sql`insert into workforce_core.posting_ledger (id, tenant_id, employee_id, office_id, post_id, charge_type, effective_from)
            values (${ledgerId}::uuid, ${tenant}::uuid, ${employeeId}::uuid, ${officeId}::uuid, ${postId}::uuid, 'substantive', '2020-01-01')`;

  return { cadreId, empCadreId, postId, occId, ledgerId };
}

let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  seedA = await seedTenant(TA, "A");
  seedB = await seedTenant(TB, "B");
});

afterAll(async () => {
  try {
    for (const t of [TA, TB]) {
      await setTenant(t);
      await sql`delete from workforce_core.post_occupancy where tenant_id = ${t}::uuid`;
      await sql`delete from workforce_core.employee_cadre where tenant_id = ${t}::uuid`;
      // posting_ledger is append-only (DELETE rejected by trigger); its rows and
      // the post/cadre they reference sit under random tenants no one else sees.
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

describe("workforce_core RLS — runtime role", () => {
  it("runs as the NOBYPASSRLS hrms_svc role (RLS actually applies)", async () => {
    const rows = await sql`select current_user as u,
      (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(rows[0].u).toBe("hrms_svc");
    expect(rows[0].bypass).toBe(false);
  });
});

describe("workforce_core RLS — FORCE RLS asserted from pg_class", () => {
  for (const { tbl } of TABLES) {
    it(`${tbl}: relrowsecurity AND relforcerowsecurity are both true`, async () => {
      const rows = await sql`
        select relrowsecurity, relforcerowsecurity
          from pg_class
         where oid = ${"workforce_core." + tbl}::regclass`;
      expect(rows).toHaveLength(1);
      expect(rows[0].relrowsecurity, `${tbl} ENABLE RLS`).toBe(true);
      expect(rows[0].relforcerowsecurity, `${tbl} FORCE RLS`).toBe(true);
    });

    it(`${tbl}: a tenant_isolation policy exists`, async () => {
      const rows = await sql`
        select policyname from pg_policies
         where schemaname = 'workforce_core' and tablename = ${tbl}`;
      const names = rows.map((r: { policyname: string }) => r.policyname);
      expect(names, `${tbl} policies`).toContain("tenant_isolation");
    });
  }
});

describe("workforce_core RLS — cross-tenant isolation (per table)", () => {
  for (const { tbl, idOf } of TABLES) {
    it(`${tbl}: tenant A cannot READ tenant B's rows`, async () => {
      await setTenant(TA);
      const own = await sql.unsafe(
        `select id from workforce_core.${tbl} where id = $1::uuid`,
        [idOf(seedA)],
      );
      expect(own.length, `A sees its own ${tbl} row`).toBe(1);
      const foreign = await sql.unsafe(
        `select id from workforce_core.${tbl} where id = $1::uuid`,
        [idOf(seedB)],
      );
      expect(foreign.length, `A cannot see B's ${tbl} row by id`).toBe(0);
      const anyB = await sql.unsafe(
        `select count(*)::int as n from workforce_core.${tbl} where tenant_id = $1::uuid`,
        [TB],
      );
      expect(anyB[0].n, `A sees zero of B's ${tbl} rows`).toBe(0);
    });

    it(`${tbl}: tenant B cannot READ tenant A's rows (symmetry)`, async () => {
      await setTenant(TB);
      const foreign = await sql.unsafe(
        `select id from workforce_core.${tbl} where id = $1::uuid`,
        [idOf(seedA)],
      );
      expect(foreign.length).toBe(0);
    });
  }

  it("post: tenant A cannot WRITE a row stamped tenant B (WITH CHECK)", async () => {
    await setTenant(TA);
    await expect(
      sql`insert into workforce_core.post (id, tenant_id, post_no, office_id)
          values (${randomUUID()}::uuid, ${TB}::uuid, ${"SEC-XW-" + tag}, ${randomUUID()}::uuid)`,
    ).rejects.toThrow();
  });

  it("cadre: tenant A cannot WRITE a row stamped tenant B (WITH CHECK)", async () => {
    await setTenant(TA);
    await expect(
      sql`insert into workforce_core.cadre (id, tenant_id, code, name)
          values (${randomUUID()}::uuid, ${TB}::uuid, ${"SEC-XC-" + tag}, 'cross tenant')`,
    ).rejects.toThrow();
  });
});

describe("workforce_core RLS — fail closed on an unset/blank tenant GUC", () => {
  // workforce_core.current_tenant_id() reads current_setting('app.tenant_id',
  // false)::uuid — a blank or unset GUC is a HARD error, not a silent empty
  // result. That is fail-closed in the strongest form: a query with no tenant
  // context is REJECTED outright, so it can never leak another tenant's rows.
  for (const { tbl } of TABLES) {
    it(`${tbl}: a blank app.tenant_id rejects the query (no silent leak)`, async () => {
      await clearTenant();
      await expect(
        sql.unsafe(`select count(*)::int as n from workforce_core.${tbl}`),
      ).rejects.toThrow();
    });
  }
});

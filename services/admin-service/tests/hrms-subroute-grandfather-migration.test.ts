/**
 * ST-M01-04b review round 1 — migration 0051 (HRMS sub-route grandfather).
 *
 * Runs the REAL migration 0051 against seeded composition.tenant_entitlement
 * rows and asserts:
 *   - a tenant holding the base HRIS `employee` module is granted the six
 *     licensable HR sibling modules as source='grandfather';
 *   - a standalone tenant (`workforce_core`, no `employee`) is granted NOTHING;
 *   - an existing explicit sibling row keeps its own source (never overwritten);
 *   - a second run changes nothing (idempotent).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const { sqlClient } = await import("../src/shared/db.js");

const EMPLOYEE = "d9000000-0000-4000-8000-0000000000c1";
const STANDALONE = "d9000000-0000-4000-8000-0000000000c2";
const PARTIAL = "d9000000-0000-4000-8000-0000000000c3";
const ACTOR = "d9000000-eeee-4000-8000-000000000001";
const TENANTS = [EMPLOYEE, STANDALONE, PARTIAL];
const SIBLINGS = ["appraisal", "attendance", "career", "ess", "leave", "recruitment"];

type Row = { module_id: string; source: string };

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}
const entitlements = (t: string) =>
  asTenant(t, (sql) =>
    sql<Row[]>`SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${t} ORDER BY module_id`);
async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, (sql) => sql`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`);
  }
}
const runMigration = async () => {
  const text = readFileSync(new URL("../migrations/0051_hrms_subroute_grandfather.sql", import.meta.url), "utf8");
  await sqlClient.unsafe(text); // owner role, like bootstrap
};

beforeAll(async () => {
  await wipe();
  await asTenant(EMPLOYEE, (sql) =>
    sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${EMPLOYEE}, 'employee', 'user', ${ACTOR})`);
  await asTenant(STANDALONE, (sql) =>
    sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${STANDALONE}, 'workforce_core', 'user', ${ACTOR})`);
  await asTenant(PARTIAL, async (sql) => {
    await sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${PARTIAL}, 'employee', 'user', ${ACTOR})`;
    await sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${PARTIAL}, 'leave', 'user', ${ACTOR})`;
  });
  await runMigration();
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("migration 0051 HRMS sub-route grandfather backfill", () => {
  it("grants an `employee` tenant the six licensable HR siblings as source='grandfather'", async () => {
    const rows = await entitlements(EMPLOYEE);
    expect(rows).toContainEqual({ module_id: "employee", source: "user" });
    for (const m of SIBLINGS) expect(rows).toContainEqual({ module_id: m, source: "grandfather" });
    expect(rows).toHaveLength(1 + SIBLINGS.length);
  });

  it("grants a standalone (`workforce_core`, no `employee`) tenant nothing", async () => {
    expect(await entitlements(STANDALONE)).toEqual([{ module_id: "workforce_core", source: "user" }]);
  });

  it("never overwrites an existing explicit sibling row", async () => {
    const rows = await entitlements(PARTIAL);
    expect(rows).toContainEqual({ module_id: "leave", source: "user" });
    for (const m of SIBLINGS.filter((s) => s !== "leave")) expect(rows).toContainEqual({ module_id: m, source: "grandfather" });
  });

  it("a second run changes nothing (idempotent)", async () => {
    const before = await Promise.all(TENANTS.map(entitlements));
    await runMigration();
    const after = await Promise.all(TENANTS.map(entitlements));
    expect(after).toEqual(before);
  });
});

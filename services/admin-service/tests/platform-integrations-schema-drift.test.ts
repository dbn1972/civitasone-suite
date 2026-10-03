/**
 * Drizzle schema versus the real database for migrations 0039/0041 (platform_integrations).
 * Checks both directions plus nullability: a declared-but-absent column is a
 * runtime 500, and a NOT NULL column Drizzle does not know about breaks every INSERT.
 */
import { describe, it, expect, afterAll } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

const { sqlClient } = await import("../src/shared/db.js");
const { providers, tenantIntegrations, productionSwitchRequests, tenantIntegrationSettings, policyChangeRequests } =
  await import("../src/modules/platform-integrations/schema.js");

afterAll(async () => { await sqlClient.end(); });

const TABLES: Array<[string, PgTable]> = [
  ["platform_integrations.providers", providers],
  ["platform_integrations.tenant_integrations", tenantIntegrations],
  ["platform_integrations.production_switch_requests", productionSwitchRequests],
  ["platform_integrations.tenant_integration_settings", tenantIntegrationSettings],
  ["platform_integrations.policy_change_requests", policyChangeRequests],
];

function normaliseType(sqlType: string): string {
  if (sqlType.endsWith("[]")) return "array";
  const bare = sqlType.replace(/\(.*\)/, "").trim().toLowerCase();
  const map: Record<string, string> = { varchar: "character varying", int: "integer", bool: "boolean" };
  return map[bare] ?? bare;
}

interface DbColumn { column_name: string; data_type: string; is_nullable: string }

describe("migrations 0039/0041 — Drizzle schema matches the database", () => {
  for (const [qualified, table] of TABLES) {
    const [schemaName = "", tableName = ""] = qualified.split(".");
    const config = getTableConfig(table);

    it(`${qualified} — declared columns exist with the same type and nullability, and nothing is undeclared`, async () => {
      const actual = await sqlClient<DbColumn[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName}`;
      expect(config.schema).toBe(schemaName);
      expect(config.name).toBe(tableName);
      const byName = new Map(actual.map((c) => [c.column_name, c]));
      const problems: string[] = [];
      for (const col of config.columns) {
        const found = byName.get(col.name);
        if (!found) { problems.push(`${col.name}: missing in DB`); continue; }
        const expected = normaliseType(col.getSQLType());
        const actualType = found.data_type === "ARRAY" ? "array" : found.data_type;
        if (actualType !== expected) problems.push(`${col.name}: drizzle=${expected} db=${actualType}`);
        if ((found.is_nullable === "NO") !== col.notNull) problems.push(`${col.name}: nullability differs`);
      }
      const declared = new Set(config.columns.map((c) => c.name));
      for (const name of byName.keys()) if (!declared.has(name)) problems.push(`${name}: in DB but not declared`);
      expect(problems).toEqual([]);
    });
  }
});

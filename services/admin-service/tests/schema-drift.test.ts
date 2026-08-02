/**
 * Drizzle-schema versus real-database drift guard for the 13 tables added by
 * migration 0027 (WC-010, WC-009, CR-MOB-01, ORG-07, DM-002).
 *
 * WHY THIS EXISTS: a column that the Drizzle table declares but the database
 * does not have (or vice versa) is a guaranteed runtime 500 on the first request
 * that touches it, and it has already shipped once in this repo —
 * `sla-engine/routes.ts` selected `t.assigned_to` where the column is
 * `assignee_id`. Nothing in `tsc` can catch that, because both sides typecheck
 * independently. This test compares them by querying
 * `information_schema.columns` and diffing against `getTableConfig()`.
 *
 * It checks BOTH directions and the nullability, because each failure mode is
 * real:
 *   • declared but absent          → SELECT/INSERT fails, 500
 *   • present but not declared     → a NOT NULL column with no default makes
 *                                    every INSERT through Drizzle fail
 *   • nullability mismatch         → either a spurious NOT NULL violation or a
 *                                    non-null type that is actually null at
 *                                    runtime
 */
import { describe, it, expect, afterAll } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

const { sqlClient } = await import("../src/shared/db.js");
const { configArtefacts, configPromotions, configEnvState } =
  await import("../src/modules/config/artefact-schema.js");
const { sandboxEnvironments, maskingRules, refreshJobs, refreshMaskedFields } =
  await import("../src/modules/sandbox/schema.js");
const { mobileTelemetryEvents, mobileScreenRenders } =
  await import("../src/modules/health/mobile-schema.js");
const { departmentTemplates, departmentInstantiations } =
  await import("../src/modules/dept-templates/schema.js");
const { documentTypes, documentRequirements, documents } =
  await import("../src/modules/uploads/doc-schema.js");

afterAll(async () => { await sqlClient.end(); });

/** Migration-0027 tables, by the module that owns them. */
const TABLES: Array<[string, PgTable]> = [
  ["config.config_artefacts", configArtefacts],
  ["config.config_promotions", configPromotions],
  ["config.config_env_state", configEnvState],
  ["sandbox.sandbox_environments", sandboxEnvironments],
  ["sandbox.masking_rules", maskingRules],
  ["sandbox.refresh_jobs", refreshJobs],
  ["sandbox.refresh_masked_fields", refreshMaskedFields],
  ["health.mobile_telemetry_events", mobileTelemetryEvents],
  ["health.mobile_screen_renders", mobileScreenRenders],
  ["dept_template.department_templates", departmentTemplates],
  ["dept_template.department_instantiations", departmentInstantiations],
  ["uploads.document_types", documentTypes],
  ["uploads.document_requirements", documentRequirements],
  ["uploads.documents", documents],
];

/**
 * Reduce a Drizzle SQL type to the spelling `information_schema` uses:
 * `varchar(64)` → `character varying`, `numeric(12, 2)` → `numeric`.
 */
function normaliseType(sqlType: string): string {
  const bare = sqlType.replace(/\(.*\)/, "").trim().toLowerCase();
  const map: Record<string, string> = {
    varchar: "character varying",
    char: "character",
    int: "integer",
    int4: "integer",
    serial: "integer",
    bigint: "bigint",
    int8: "bigint",
    bool: "boolean",
    "timestamp with time zone": "timestamp with time zone",
    "timestamp without time zone": "timestamp without time zone",
    timestamp: "timestamp without time zone",
  };
  return map[bare] ?? bare;
}

interface DbColumn { column_name: string; data_type: string; is_nullable: string; column_default: string | null }

async function dbColumns(schema: string, table: string): Promise<DbColumn[]> {
  return sqlClient<DbColumn[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table}
    ORDER BY ordinal_position`;
}

describe("migration 0027 — Drizzle schema matches the real database", () => {
  for (const [qualified, table] of TABLES) {
    const [schemaName = "", tableName = ""] = qualified.split(".");
    const config = getTableConfig(table);

    it(`${qualified} — the Drizzle table names the same schema and table`, () => {
      expect(config.schema).toBe(schemaName);
      expect(config.name).toBe(tableName);
    });

    it(`${qualified} — every declared column exists in the database with the same type`, async () => {
      const actual = await dbColumns(schemaName, tableName);
      expect(actual.length, `${qualified} is missing from the database entirely`).toBeGreaterThan(0);
      const byName = new Map(actual.map((c) => [c.column_name, c]));

      const missing: string[] = [];
      const wrongType: string[] = [];
      for (const col of config.columns) {
        const found = byName.get(col.name);
        if (!found) {
          missing.push(col.name);
          continue;
        }
        const expected = normaliseType(col.getSQLType());
        if (found.data_type !== expected) {
          wrongType.push(`${col.name}: drizzle=${expected} db=${found.data_type}`);
        }
      }
      expect(missing, `${qualified}: columns declared in Drizzle but absent from the DB`).toEqual([]);
      expect(wrongType, `${qualified}: column type mismatches`).toEqual([]);
    });

    it(`${qualified} — the database has no column the Drizzle table does not declare`, async () => {
      const actual = await dbColumns(schemaName, tableName);
      const declared = new Set(config.columns.map((c) => c.name));
      const undeclared = actual.filter((c) => !declared.has(c.column_name)).map((c) => c.column_name);
      expect(undeclared, `${qualified}: DB columns unknown to Drizzle`).toEqual([]);
    });

    it(`${qualified} — nullability agrees on every column`, async () => {
      const actual = await dbColumns(schemaName, tableName);
      const byName = new Map(actual.map((c) => [c.column_name, c]));
      const mismatched: string[] = [];
      for (const col of config.columns) {
        const found = byName.get(col.name);
        if (!found) continue; // reported by the previous test
        const dbNotNull = found.is_nullable === "NO";
        if (col.notNull !== dbNotNull) {
          mismatched.push(`${col.name}: drizzle notNull=${col.notNull} db notNull=${dbNotNull}`);
        }
      }
      expect(mismatched, `${qualified}: nullability drift`).toEqual([]);
    });
  }

  it("every timestamp column is timestamptz, never a naive timestamp", async () => {
    const naive: string[] = [];
    for (const [qualified] of TABLES) {
      const [schemaName = "", tableName = ""] = qualified.split(".");
      const cols = await dbColumns(schemaName, tableName);
      for (const c of cols) {
        if (c.data_type === "timestamp without time zone") naive.push(`${qualified}.${c.column_name}`);
      }
    }
    expect(naive).toEqual([]);
  });

  it("every table is tenant-scoped, RLS-enabled AND RLS-forced", async () => {
    const rows = await sqlClient<Array<{ qualified: string; rls: boolean; forced: boolean }>>`
      SELECT n.nspname || '.' || c.relname AS qualified,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('config', 'sandbox', 'health', 'dept_template', 'uploads')
        AND c.relkind = 'r'`;
    const byName = new Map(rows.map((r) => [r.qualified, r]));
    const unprotected: string[] = [];
    for (const [qualified] of TABLES) {
      const row = byName.get(qualified);
      if (!row || !row.rls || !row.forced) unprotected.push(qualified);
    }
    expect(unprotected).toEqual([]);
  });

  it("every table carries tenant_id and a version column for optimistic locking", () => {
    const gaps: string[] = [];
    for (const [qualified, table] of TABLES) {
      const names = new Set(getTableConfig(table).columns.map((c) => c.name));
      if (!names.has("tenant_id")) gaps.push(`${qualified}: no tenant_id`);
      if (!names.has("version")) gaps.push(`${qualified}: no version`);
    }
    expect(gaps).toEqual([]);
  });
});

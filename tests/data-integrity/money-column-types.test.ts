/**
 * Phase-4 Data Integrity — Check #2 (cross-DB): money-precision column typing.
 *
 * Money in CivitasOne is stored as integer minor units (paise) in bigint
 * columns. A money value in a float/double/real/money column, or a numeric with
 * scale > 0, can silently lose precision — that is a FINDING.
 *
 * We scan information_schema.columns across the finance, payroll, billing and
 * procurement databases and assert:
 *   (a) NO money-ish column uses a lossy type (double precision / real / money,
 *       or numeric with scale > 0), and
 *   (b) EVERY `%_minor` column is bigint.
 *
 * Empirically (2026-07-25) all four DBs pass: 0 lossy float money columns, and
 * every _minor column is bigint (finance 87, payroll 110, billing 8,
 * procurement 24 = 229 columns). One benign observation is logged: the finance
 * anomaly table stores `amount_paise` as text — lossless (exact digits), but
 * atypically typed; not a precision FINDING because text cannot round-float.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createSqlClient } from "../../packages/db/src/index.js";

const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5435";
const ADMIN_USER = process.env.PGADMIN_USER ?? "civitas_admin";
const ADMIN_PW = process.env.PGADMIN_PW ?? "civitas_dev_pw";

const DBS = ["civitas_finance", "civitas_payroll", "civitas_billing", "civitas_procurement"];

const openClients: Array<{ end: () => Promise<void> }> = [];
function client(db: string) {
  const c = createSqlClient(`postgres://${ADMIN_USER}:${ADMIN_PW}@${HOST}:${PORT}/${db}`, {
    max: 2,
    prepare: false,
  });
  openClients.push(c as unknown as { end: () => Promise<void> });
  return c;
}

afterAll(async () => {
  await Promise.all(openClients.map((c) => c.end().catch(() => {})));
});

// Names that denote a monetary amount. Deliberately excludes obvious non-money
// matches like *_id (cost_center_id) and booleans (is_employer_cost).
const MONEY_NAME_RE = "(amount|_minor|paise|salary|wage|gross|net_pay|_tax|_fee|_price|_cost)";

describe("Check #2 — money columns are integer minor units, never lossy floats", () => {
  for (const db of DBS) {
    it(`${db}: no money column uses a lossy float/numeric-with-scale type`, async () => {
      const sql = client(db);
      const lossy = await sql.unsafe(`
        SELECT table_schema, table_name, column_name, data_type, numeric_scale
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
          AND column_name ~* '${MONEY_NAME_RE}'
          AND column_name NOT LIKE '%\\_id'
          AND data_type NOT IN ('boolean','uuid')
          AND (
            data_type IN ('double precision','real','money')
            OR (data_type = 'numeric' AND COALESCE(numeric_scale, 0) > 0)
          )
        ORDER BY 1,2,3
      `);
      if (lossy.length > 0) {
        // FINDING: lossy money column(s) that can drop paise.
        // eslint-disable-next-line no-console
        console.error(
          `[MONEY] ${db} LOSSY money columns:`,
          lossy.map((r: any) => `${r.table_schema}.${r.table_name}.${r.column_name}::${r.data_type}(${r.numeric_scale})`),
        );
      }
      expect(lossy.map((r: any) => `${r.table_schema}.${r.table_name}.${r.column_name}`)).toEqual([]);
    });

    it(`${db}: every %_minor column is bigint`, async () => {
      const sql = client(db);
      const nonBigint = await sql.unsafe(`
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
          AND column_name LIKE '%\\_minor'
          AND data_type <> 'bigint'
        ORDER BY 1,2,3
      `);
      const totalMinor = Number(
        (await client(db).unsafe(`
          SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog','information_schema')
            AND column_name LIKE '%\\_minor'
        `))[0].n,
      );
      // eslint-disable-next-line no-console
      console.log(`[MONEY] ${db}: _minor columns=${totalMinor} non-bigint=${nonBigint.length}`);
      expect(nonBigint.map((r: any) => `${r.table_schema}.${r.table_name}.${r.column_name}::${r.data_type}`)).toEqual([]);
    });
  }
});

/**
 * SEC-009 (inspection-service) — FORCE ROW LEVEL SECURITY on
 * reports.inspection_reports / reports.observations
 * (migration 0030_force_rls_sec_009.sql).
 *
 * The SEC-009 gap-report evidence cell names only inspection_reports.
 * reports.observations is included here too: 0029_sec_002_rls_isolation.sql
 * (the SEC-002 fix) explicitly says in its own fix notes
 * "reports.inspection_reports/observations (ENABLE without FORCE)
 * intentionally left to SEC-009" — observations was always meant to be
 * closed by this gap, just dropped from the SEC-009 row's evidence cell.
 * Verified live: both tables were ENABLE-without-FORCE before this
 * migration.
 *
 * ARCHITECTURE NOTE — this table's owner-bypass is shaped differently from
 * every other SEC-009 table. inspection-service is one of the deliberately
 * "admin-owned" services (see infra/db/bootstrap/bootstrap_inspection.sql:
 * "schema ownership stays with civitas_admin so migrations are admin-run
 * and the service role cannot alter its own tables" — the same convention
 * as court-service). Confirmed live against this database:
 *
 *   SELECT tableowner FROM pg_tables WHERE schemaname='reports';
 *   -- both inspection_reports and observations: civitas_admin
 *
 * inspection_svc — the role the application actually connects as (see
 * vitest.config.ts's DATABASE_URL) — only holds GRANTed SELECT/INSERT/
 * UPDATE, never ownership. Postgres only ever exempts a table's OWNER from
 * its own RLS policies (and only when FORCE is absent) — a non-owner role
 * without BYPASSRLS is unconditionally subject to RLS regardless of FORCE.
 * So inspection_svc was never able to bypass these policies in the first
 * place, FORCE or not; testing "no context" through inspection_svc (the
 * pattern services/inspection-service/tests/sec-002-rls-isolation.test.ts
 * uses for ITS 21 tables) would pass identically whether or not this
 * migration existed, and would not actually prove this fix does anything.
 *
 * The role FORCE genuinely binds here is the table owner, civitas_admin —
 * so that is who this test connects as to reproduce the real bug and its
 * fix, using the same civitas_admin connection convention already
 * established in services/inventory-service/tests/data-quality.test.ts.
 *
 * (Note: this also means sec-002-rls-isolation.test.ts's own "no context"
 * comment — "the service DB role owns these tables" — does not hold for
 * inspection-service's admin-owned schemas; its cross-tenant A-vs-B
 * assertions are still valid, but its owner-bypass narrative is not
 * actually exercised by connecting as inspection_svc. Out of scope for
 * SEC-009 — flagged separately.)
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT = "5ec00090-0030-4020-8000-000000000001";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

async function insertReturningId(tx: TxRunner, query: ReturnType<typeof sql>): Promise<string> {
  const rows = rowsOf(await tx.execute(query));
  const id = rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error(`insert did not return an id: ${JSON.stringify(rows)}`);
  }
  return id;
}

// Same convention as services/inventory-service/tests/data-quality.test.ts:
// CI bootstrap sets civitas_admin's password from PGPASSWORD/
// POSTGRES_ADMIN_PASSWORD (civitas_test); local compose defaults to
// civitas_dev_pw.
const ADMIN_PW =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");
const HOST = process.env.PGHOST ?? "localhost";
const PORT = Number(process.env.PGPORT ?? "5435");

const adminSql = postgres({
  host: HOST,
  port: PORT,
  database: "civitas_inspection",
  username: "civitas_admin",
  password: ADMIN_PW,
  max: 1,
  idle_timeout: 5,
});

describe("SEC-009 (inspection) — table coverage", () => {
  it("reports.inspection_reports / reports.observations are both owned by civitas_admin, not inspection_svc", async () => {
    const rows = await sqlClient`
      SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'reports' AND tablename IN ('inspection_reports', 'observations')
      ORDER BY tablename
    `;
    expect(rows).toEqual([
      { tablename: "inspection_reports", tableowner: "civitas_admin" },
      { tablename: "observations", tableowner: "civitas_admin" },
    ]);
  });
});

describe("SEC-009 (inspection) — FORCE RLS strips civitas_admin's owner bypass", () => {
  afterAll(async () => {
    await sqlClient.end();
    await adminSql.end();
  });

  it("reports.inspection_reports / reports.observations are ENABLE + FORCE (post-migration 0030 state)", async () => {
    for (const qualified of ["reports.inspection_reports", "reports.observations"]) {
      const [state] = rowsOf(
        await sqlClient`
          SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${qualified}::regclass
        `,
      );
      expect(state?.relrowsecurity).toBe(true);
      expect(state?.relforcerowsecurity).toBe(true);
    }
  });

  it("reports.inspection_reports: civitas_admin (table owner) with no tenant GUC set sees zero rows unscoped", async () => {
    const id = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      insertReturningId(
        tx,
        sql`INSERT INTO reports.inspection_reports
              (tenant_id, inspection_id, entity_id, inspector_id, created_by, updated_by)
            VALUES (${TENANT}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
    );

    // Bare query as the true OWNING role, civitas_admin, with app.tenant_id
    // never set anywhere in this connection's lifetime -- exactly the shape
    // of an ad hoc admin/maintenance query. Before 0030 this silently
    // returned the row (owner bypass); after, the missing_ok policy
    // evaluates to NULL and filters it out.
    const unscoped = await adminSql`SELECT id FROM reports.inspection_reports WHERE id = ${id}`;
    expect(unscoped).toHaveLength(0);

    // Positive control: the row genuinely exists and is readable through the
    // correctly tenant-scoped path (as inspection_svc, the app's real role).
    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.inspection_reports WHERE id = ${id}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });

  it("reports.observations: civitas_admin (table owner) with no tenant GUC set sees zero rows unscoped", async () => {
    const id = await withTenantScope(db as never, TENANT, async (tx: TxRunner) => {
      const reportId = await insertReturningId(
        tx,
        sql`INSERT INTO reports.inspection_reports
              (tenant_id, inspection_id, entity_id, inspector_id, created_by, updated_by)
            VALUES (${TENANT}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      );
      return insertReturningId(
        tx,
        sql`INSERT INTO reports.observations (tenant_id, report_id, category, description, created_by)
            VALUES (${TENANT}, ${reportId}::uuid, 'sec-009 probe', 'sec-009 probe observation', ${randomUUID()})
            RETURNING id`,
      );
    });

    const unscoped = await adminSql`SELECT id FROM reports.observations WHERE id = ${id}`;
    expect(unscoped).toHaveLength(0);

    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.observations WHERE id = ${id}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });
});

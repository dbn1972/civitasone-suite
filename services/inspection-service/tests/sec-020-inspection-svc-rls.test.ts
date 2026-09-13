/**
 * SEC-020 (inspection-service) — cross-tenant RLS through the REAL
 * inspection_svc role (not the table owner) on reports.inspection_reports /
 * reports.observations.
 *
 * BACKGROUND
 * These 2 tables are owned by civitas_admin, not inspection_svc — a
 * deliberate design (infra/db/bootstrap/bootstrap_inspection.sql: "schema
 * ownership stays with civitas_admin so migrations are admin-run and the
 * service role cannot alter its own tables", mirroring court-service).
 * SEC-009 (migration 0030_force_rls_sec_009.sql) added FORCE ROW LEVEL
 * SECURITY on both tables, which strips the OWNER's (civitas_admin's) RLS
 * bypass — see tests/sec-009-force-rls.test.ts, which correctly connects as
 * civitas_admin to prove that fix, since FORCE only ever matters for a
 * table's owner.
 *
 * But inspection_svc — the role the application actually connects as (see
 * vitest.config.ts's DATABASE_URL, and shared/db.ts's createTenantDb()) — is
 * a plain NOBYPASSRLS, non-owner role. Postgres subjects a non-owner,
 * non-BYPASSRLS role to RLS unconditionally, regardless of FORCE. So
 * inspection_svc's own cross-tenant access through the normal
 * rls_reports / rls_observations policies (migration 0025_reports.sql) was
 * never exercised by SEC-009's test, and sec-002-rls-isolation.test.ts's own
 * tenant A/B cross-read pattern is scoped to its 21 tables only (capa/
 * enforcement/licence/survey/telemetry/encroachment/illegal_construction) —
 * reports.inspection_reports/observations do not appear in that file at all.
 *
 * CITATION CORRECTION: the SEC-020 gap-report row attributes a "flagged
 * separately" comment to sec-002-rls-isolation.test.ts's header. That text
 * actually lives in sec-009-force-rls.test.ts's header instead (its closing
 * paragraph: "Out of scope for SEC-009 — flagged separately."). Confirmed by
 * reading sec-002-rls-isolation.test.ts in full and by `git log --follow`
 * on it (one commit, #1107, never touched since; no mention anywhere in it
 * of "reports.", "civitas_admin", "SEC-009", "SEC-020" or "flagged
 * separately"). The substance of the gap is accurate either way — no
 * inspection_svc-role cross-tenant test existed for these 2 tables — only
 * the file citation was wrong. Noted here rather than silently corrected,
 * per this campaign's convention (see e.g. SEC-002's own migration note on
 * the gap-report's "23 tables" claim, or TX-017's "Corrected entry" rows).
 *
 * This file closes the real hole directly: seeds tenant A's and tenant B's
 * own rows in BOTH tables through the real inspection_svc pool, then proves
 * neither tenant's session can read the other's row through the normal
 * (non-owner, non-bypass) RLS path — with a positive control per tenant
 * proving the policy isn't simply denying everyone.
 *
 * DoD (per the gap-report row): this test fails against a deliberately
 * misconfigured/dropped policy and passes against the current one, run as
 * inspection_svc specifically. Verified by hand against a disposable
 * cluster as part of this fix: replacing rls_reports/rls_observations with
 * a `USING (true)` policy makes the cross-tenant assertions below fail
 * (genuine leakage reproduced, matching the real vulnerability shape this
 * gap is worried about); restoring migration 0025's real predicate makes
 * the whole file pass again.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT_A = "aaaaaaaa-5ec0-0020-8000-000000000001";
const TENANT_B = "bbbbbbbb-5ec0-0020-8000-000000000002";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  // postgres.js/drizzle both return an array-like with the rows.
  return Array.from(result as Iterable<Record<string, unknown>>);
}

async function insertReturningId(
  tx: TxRunner,
  query: ReturnType<typeof sql>,
): Promise<string> {
  const rows = rowsOf(await tx.execute(query));
  const id = rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error(`insert did not return an id: ${JSON.stringify(rows)}`);
  }
  return id;
}

async function insertReport(tx: TxRunner, tenantId: string): Promise<string> {
  return insertReturningId(
    tx,
    sql`INSERT INTO reports.inspection_reports
          (tenant_id, inspection_id, entity_id, inspector_id, created_by, updated_by)
        VALUES (${tenantId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
        RETURNING id`,
  );
}

async function insertObservation(
  tx: TxRunner,
  tenantId: string,
  reportId: string,
): Promise<string> {
  return insertReturningId(
    tx,
    sql`INSERT INTO reports.observations (tenant_id, report_id, category, description, created_by)
        VALUES (${tenantId}, ${reportId}::uuid, 'sec-020 probe', 'sec-020 cross-tenant probe observation', ${randomUUID()})
        RETURNING id`,
  );
}

describe("SEC-020 (inspection) — cross-tenant RLS via the real inspection_svc role", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it("this suite really runs as inspection_svc, not civitas_admin or any other role", async () => {
    const rows = rowsOf(await sqlClient`SELECT current_user`);
    expect(rows[0]?.current_user).toBe("inspection_svc");
  });

  it("reports.inspection_reports: tenant A and tenant B each see only their own row, never the other's", async () => {
    const reportA = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
      insertReport(tx, TENANT_A),
    );
    const reportB = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
      insertReport(tx, TENANT_B),
    );

    const bReadsA = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.inspection_reports WHERE id = ${reportA}::uuid`),
    );
    expect(rowsOf(bReadsA)).toHaveLength(0);

    const aReadsB = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.inspection_reports WHERE id = ${reportB}::uuid`),
    );
    expect(rowsOf(aReadsB)).toHaveLength(0);

    // Positive controls — prove the policy isn't simply denying everyone.
    const aReadsA = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.inspection_reports WHERE id = ${reportA}::uuid`),
    );
    expect(rowsOf(aReadsA)).toHaveLength(1);

    const bReadsB = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.inspection_reports WHERE id = ${reportB}::uuid`),
    );
    expect(rowsOf(bReadsB)).toHaveLength(1);
  });

  it("reports.observations: tenant A and tenant B each see only their own row, never the other's", async () => {
    const obsA = await withTenantScope(db as never, TENANT_A, async (tx: TxRunner) => {
      const reportId = await insertReport(tx, TENANT_A);
      return insertObservation(tx, TENANT_A, reportId);
    });
    const obsB = await withTenantScope(db as never, TENANT_B, async (tx: TxRunner) => {
      const reportId = await insertReport(tx, TENANT_B);
      return insertObservation(tx, TENANT_B, reportId);
    });

    const bReadsA = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.observations WHERE id = ${obsA}::uuid`),
    );
    expect(rowsOf(bReadsA)).toHaveLength(0);

    const aReadsB = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.observations WHERE id = ${obsB}::uuid`),
    );
    expect(rowsOf(aReadsB)).toHaveLength(0);

    // Positive controls.
    const aReadsA = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.observations WHERE id = ${obsA}::uuid`),
    );
    expect(rowsOf(aReadsA)).toHaveLength(1);

    const bReadsB = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM reports.observations WHERE id = ${obsB}::uuid`),
    );
    expect(rowsOf(bReadsB)).toHaveLength(1);
  });
});

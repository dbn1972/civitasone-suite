/**
 * SEC-009 (hrms-service) — FORCE ROW LEVEL SECURITY on
 * learning.training_plans / learning.training_plan_items
 * (migration 0139_force_rls_sec_009.sql).
 *
 * hrms_svc is the OWNER of both tables (0108_learning_training_plans.sql
 * ran as hrms_svc — see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS
 * loop). Postgres exempts a table's OWNER from its own RLS policies unless
 * FORCE ROW LEVEL SECURITY is set. Before migration 0139, hrms_svc — the
 * exact role the application connects as (see vitest.config.ts's
 * DATABASE_URL) — silently bypassed the `tenant_isolation` policy entirely
 * on any bare, unscoped query.
 *
 * learning's policies use current_setting('app.tenant_id', true) — the
 * `missing_ok` form. On a session that has NEVER touched app.tenant_id,
 * that evaluates to NULL and the predicate filters every row out: a silent
 * empty read. That "never touched" condition matters: the shared
 * `sqlClient` pool used for seeding already ran a (transaction-local,
 * since-reset) set_config for app.tenant_id, and on a pooled connection
 * reused from that same pool, Postgres treats the custom GUC name as
 * already known and current_setting() returns '' instead of NULL — which
 * then fails the policy's `::uuid` cast outright rather than filtering
 * silently. Both are "the owner no longer bypasses RLS", but to assert the
 * specific, documented "silent empty read" shape deterministically, the
 * unscoped attack query below runs on a dedicated one-shot connection
 * instead of the shared pool.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT = "5ec00090-0139-4020-8000-000000000001";

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

/**
 * A brand-new, never-before-used connection as the same service role the
 * app connects as, used for exactly one query then closed. See the
 * file-header comment for why this needs to be a fresh connection rather
 * than the shared pool.
 */
async function queryOnFreshConnection<T = Record<string, unknown>>(
  query: (sql: ReturnType<typeof postgres>) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await query(client);
  } finally {
    await client.end();
  }
}

describe("SEC-009 (hrms) — FORCE RLS strips hrms_svc's owner bypass", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it("learning.training_plans / learning.training_plan_items are ENABLE + FORCE (post-migration 0139 state)", async () => {
    for (const qualified of ["learning.training_plans", "learning.training_plan_items"]) {
      const [state] = rowsOf(
        await sqlClient`
          SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${qualified}::regclass
        `,
      );
      expect(state?.relrowsecurity).toBe(true);
      expect(state?.relforcerowsecurity).toBe(true);
    }
  });

  it("learning.training_plans: hrms_svc (owner) with no tenant GUC ever set sees zero rows unscoped", async () => {
    const id = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      insertReturningId(
        tx,
        sql`INSERT INTO learning.training_plans (tenant_id, title, plan_year, created_by)
            VALUES (${TENANT}, 'sec-009 probe plan', 2026, ${randomUUID()}) RETURNING id`,
      ),
    );

    const unscoped = await queryOnFreshConnection(
      (freshSql) => freshSql`SELECT id FROM learning.training_plans WHERE id = ${id}`,
    );
    expect(unscoped).toHaveLength(0);

    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM learning.training_plans WHERE id = ${id}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });

  it("learning.training_plan_items: hrms_svc (owner) with no tenant GUC ever set sees zero rows unscoped", async () => {
    const itemId = await withTenantScope(db as never, TENANT, async (tx: TxRunner) => {
      const planId = await insertReturningId(
        tx,
        sql`INSERT INTO learning.training_plans (tenant_id, title, plan_year, created_by)
            VALUES (${TENANT}, 'sec-009 probe plan for item', 2026, ${randomUUID()}) RETURNING id`,
      );
      return insertReturningId(
        tx,
        sql`INSERT INTO learning.training_plan_items (tenant_id, plan_id)
            VALUES (${TENANT}, ${planId}::uuid) RETURNING id`,
      );
    });

    const unscoped = await queryOnFreshConnection(
      (freshSql) => freshSql`SELECT id FROM learning.training_plan_items WHERE id = ${itemId}`,
    );
    expect(unscoped).toHaveLength(0);

    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM learning.training_plan_items WHERE id = ${itemId}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });
});

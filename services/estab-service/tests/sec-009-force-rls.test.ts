/**
 * SEC-009 (estab-service) — FORCE ROW LEVEL SECURITY on consumables.items /
 * consumables.transactions (migration 0044_force_rls_sec_009.sql).
 *
 * estab_svc is the OWNER of both tables (0041_consumables.sql ran as
 * estab_svc — see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS loop).
 * Postgres exempts a table's OWNER from its own RLS policies unless FORCE
 * ROW LEVEL SECURITY is set. Before migration 0044, estab_svc — the exact
 * role the application connects as (see vitest.config.ts's DATABASE_URL) —
 * silently bypassed rls_consumable_items/rls_consumable_txns entirely on
 * any bare, unscoped query.
 *
 * consumables' policies use current_setting('app.tenant_id', true) — the
 * `missing_ok` form. On a session that has NEVER touched app.tenant_id,
 * that evaluates to NULL and the predicate filters every row out: a silent
 * empty read, the same shape TX-012 and SEC-002 documented for their
 * tables. That "never touched" condition matters: the shared `sqlClient`
 * pool used for seeding already ran a (transaction-local, since-reset)
 * set_config for app.tenant_id, and on a pooled connection reused from that
 * same pool, Postgres treats the custom GUC name as already known and
 * current_setting() returns '' instead of NULL -- which then fails the
 * policy's `::uuid` cast outright rather than filtering silently. Both are
 * "the owner no longer bypasses RLS", but to assert the specific,
 * documented "silent empty read" shape deterministically, the unscoped
 * attack query below runs on a dedicated one-shot connection instead of the
 * shared pool.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT = "5ec00090-0044-4020-8000-000000000001";

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
 * app connects as (same DATABASE_URL the service's own sqlClient was built
 * from), used for exactly one query then closed. Guarantees app.tenant_id
 * has never been touched in this session, so current_setting(key, true)'s
 * NULL-on-unset behaviour is deterministic instead of connection-pool-
 * history-dependent.
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

describe("SEC-009 (estab) — FORCE RLS strips estab_svc's owner bypass", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it("consumables.items / consumables.transactions are ENABLE + FORCE (post-migration 0044 state)", async () => {
    for (const qualified of ["consumables.items", "consumables.transactions"]) {
      const [state] = rowsOf(
        await sqlClient`
          SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${qualified}::regclass
        `,
      );
      expect(state?.relrowsecurity).toBe(true);
      expect(state?.relforcerowsecurity).toBe(true);
    }
  });

  it("consumables.items: estab_svc (owner) with no tenant GUC ever set sees zero rows unscoped", async () => {
    const id = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      insertReturningId(
        tx,
        sql`INSERT INTO consumables.items (tenant_id, name, created_by, updated_by)
            VALUES (${TENANT}, 'sec-009 probe item', ${randomUUID()}, ${randomUUID()}) RETURNING id`,
      ),
    );

    // Before 0044 this silently returned the row (owner bypass); after, the
    // missing_ok policy evaluates current_setting() to NULL and filters it
    // out.
    const unscoped = await queryOnFreshConnection(
      (freshSql) => freshSql`SELECT id FROM consumables.items WHERE id = ${id}`,
    );
    expect(unscoped).toHaveLength(0);

    // Positive control: the row genuinely exists and is readable through the
    // correctly tenant-scoped path.
    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM consumables.items WHERE id = ${id}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });

  it("consumables.transactions: estab_svc (owner) with no tenant GUC ever set sees zero rows unscoped", async () => {
    const txnId = await withTenantScope(db as never, TENANT, async (tx: TxRunner) => {
      const itemId = await insertReturningId(
        tx,
        sql`INSERT INTO consumables.items (tenant_id, name, created_by, updated_by)
            VALUES (${TENANT}, 'sec-009 probe item for txn', ${randomUUID()}, ${randomUUID()}) RETURNING id`,
      );
      return insertReturningId(
        tx,
        sql`INSERT INTO consumables.transactions (tenant_id, item_id, txn_type, qty, created_by)
            VALUES (${TENANT}, ${itemId}::uuid, 'receipt', 5, ${randomUUID()}) RETURNING id`,
      );
    });

    const unscoped = await queryOnFreshConnection(
      (freshSql) => freshSql`SELECT id FROM consumables.transactions WHERE id = ${txnId}`,
    );
    expect(unscoped).toHaveLength(0);

    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM consumables.transactions WHERE id = ${txnId}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });
});

import { sql, type SQL } from "drizzle-orm";
import { scoped } from "./_tenant.js";

/**
 * Remove rows a test itself wrote to the append-only gl.finance_ledger.
 *
 * Why this exists: gl.finance_ledger has a BEFORE UPDATE/DELETE trigger
 * (trg_ledger_no_mutate, migration 0014) and FORCE ROW LEVEL SECURITY. A bare
 * `DELETE ... .catch(() => {})` therefore silently removes nothing (RLS hides the
 * rows without the tenant GUC, and the trigger would raise anyway), so tests that
 * post above-2^53 amounts left those rows behind on any reused database and
 * tripped inventory-service's DQ-FIN-03 ("no bigint-overflow rows in the ledger").
 *
 * The finance service role owns the table, so a test may, for the duration of ONE
 * transaction, re-grant itself DELETE and disable the trigger. GRANT/REVOKE and
 * ALTER TABLE ... DISABLE/ENABLE TRIGGER are transactional DDL, so no other session
 * ever sees the relaxed state and it is restored (or rolled back) on every path. Always pass a `where`
 * that selects only this test's own rows.
 */
export async function purgeLedgerRows(tenantId: string, where: SQL): Promise<void> {
  await scoped(tenantId, async (tx: any) => {
    // finance_svc owns the table but migration 0014 REVOKEd DELETE from it; as owner it may
    // re-grant itself, all inside this one transaction (rolled back together on any error).
    await tx.execute(sql`GRANT DELETE ON gl.finance_ledger TO finance_svc`);
    await tx.execute(sql`ALTER TABLE gl.finance_ledger DISABLE TRIGGER trg_ledger_no_mutate`);
    await tx.execute(sql`DELETE FROM gl.finance_ledger WHERE tenant_id = ${tenantId}::uuid AND (${where})`);
    await tx.execute(sql`ALTER TABLE gl.finance_ledger ENABLE TRIGGER trg_ledger_no_mutate`);
    await tx.execute(sql`REVOKE DELETE ON gl.finance_ledger FROM finance_svc`);
  });
}

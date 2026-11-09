import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";

export interface DaRateRow {
  id: string;
  effectiveFrom: string;
  rateBps: number;
  orderRef: string | null;
  createdAt: string;
}

type Tx = Pick<typeof db, "execute">;

/** Every DA row of the tenant, oldest first. Call inside a tenant-scoped transaction (RLS). */
export async function loadDaRates(tx: Tx, tenantId: string): Promise<DaRateRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, rate_bps, order_ref, created_at
      FROM payroll.dearness_allowance_rates
     WHERE tenant_id = ${tenantId}::uuid
     ORDER BY effective_from ASC
  `)) as unknown as Array<{ id: string; effective_from: string; rate_bps: number; order_ref: string | null; created_at: string | Date }>;
  return rows.map((r) => ({
    id: r.id, effectiveFrom: r.effective_from, rateBps: Number(r.rate_bps), orderRef: r.order_ref,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/**
 * Processed payroll months (YYYY-MM) that resolve their DA from `rate`: months in
 * [rate.effectiveFrom, next rate's effectiveFrom) with a run that is past draft
 * (processing / computed / approved / disbursed / paid; draft, failed and cancelled runs never priced a payslip). Deleting such a rate would silently
 * re-price (or fail) a payroll that has already been run.
 */
export async function processedMonthsUsingRate(tx: Tx, tenantId: string, rate: DaRateRow, all: DaRateRow[]): Promise<string[]> {
  const next = all.find((r) => r.effectiveFrom > rate.effectiveFrom);
  const from = rate.effectiveFrom.slice(0, 7);
  const to = next ? next.effectiveFrom.slice(0, 7) : null;
  const rows = (await tx.execute(sql`
    SELECT DISTINCT month FROM payroll.payroll_runs
     WHERE tenant_id = ${tenantId}::uuid
       AND status IN ('processing', 'computed', 'approved', 'disbursed', 'paid')
       AND month >= ${from}
       AND (${to}::text IS NULL OR month < ${to})
     ORDER BY month
  `)) as unknown as Array<{ month: string }>;
  return rows.map((r) => String(r.month).trim());
}

/**
 * Per-tenant advisory lock keyed on the DA series. The delete consumer takes it exclusively; a
 * payroll run takes it shared while it looks up its DA rate, so a delete cannot interleave with
 * a run's lookup (transaction-scoped: released at commit / rollback).
 */
export async function lockDaRates(tx: Tx, tenantId: string, mode: "shared" | "exclusive"): Promise<void> {
  if (mode === "shared") await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"da-rate:" + tenantId}, 0))`);
  else await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"da-rate:" + tenantId}, 0))`);
}

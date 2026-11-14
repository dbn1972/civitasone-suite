/**
 * M6 price store (plans.plan_prices): effective-dated, append-only price per plan and per add-on module.
 * Rules (overlap, GST, quote) live in @civitasone/schemas/plan-pricing; this file is persistence only.
 * READS run in a tenant-scoped transaction (FORCED RLS). WRITES are used ONLY by the consumer, inside its transaction.
 */
import { and, eq, asc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { PriceRow } from "@civitasone/schemas/plan-pricing";
import { db } from "../../shared/db.js";
import { planPrices, type PlanPriceRow } from "./schema.js";

function toPrice(r: PlanPriceRow): PriceRow {
  return {
    id: r.id, subjectKind: r.subjectKind, subjectKey: r.subjectKey, billingCycle: r.billingCycle,
    amountMinor: r.amountMinor, gstRateBps: r.gstRateBps, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
  };
}

export async function listPrices(tenantId: string, filter: { kind?: "plan" | "addon" | undefined; key?: string | undefined } = {}): Promise<PriceRow[]> {
  const conds = [eq(planPrices.tenantId, tenantId)];
  if (filter.kind) conds.push(eq(planPrices.subjectKind, filter.kind));
  if (filter.key) conds.push(eq(planPrices.subjectKey, filter.key));
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.select().from(planPrices).where(and(...conds)).orderBy(asc(planPrices.subjectKind), asc(planPrices.subjectKey), asc(planPrices.billingCycle), asc(planPrices.effectiveFrom))));
  return rows.map(toPrice);
}

export type Tx = Pick<typeof db, "insert" | "update" | "select">;

export async function listForSubjectTx(tx: Tx, tenantId: string, kind: "plan" | "addon", key: string, cycle: PriceRow["billingCycle"]): Promise<PriceRow[]> {
  const rows = await tx.select().from(planPrices).where(and(
    eq(planPrices.tenantId, tenantId), eq(planPrices.subjectKind, kind), eq(planPrices.subjectKey, key), eq(planPrices.billingCycle, cycle)));
  return rows.map(toPrice);
}

export async function closeTx(tx: Tx, id: string, effectiveTo: string): Promise<void> {
  await tx.update(planPrices).set({ effectiveTo }).where(eq(planPrices.id, id));
}

export async function insertTx(tx: Tx, row: typeof planPrices.$inferInsert): Promise<void> {
  await tx.insert(planPrices).values(row);
}

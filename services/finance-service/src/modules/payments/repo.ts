import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, scopedRead } from "../../shared/db.js";
import { financeBills, financePayments, financeAdvances, financeUC, financeGrnMatch, type BillRow, type BillInsert, type PaymentRow, type PaymentInsert, type AdvanceRow, type AdvanceInsert, type UCRow, type UCInsert, type GrnMatchRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

// ── R5: AP three-way-match read-model (populated from procurement.grn.accepted) ─

/** Upsert the authoritative PO + GRN(accepted) values for a GRN (keyed by tenant+grnRef). */
export async function upsertGrnMatch(
  tx: Exec,
  m: { tenantId: string; grnRef: string; poRef: string; vendorId: string; poAmountMinor: bigint; grnAmountMinor: bigint },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO payments.finance_grn_match
      (tenant_id, grn_ref, po_ref, vendor_id, po_amount_minor, grn_amount_minor)
    VALUES (${m.tenantId}::uuid, ${m.grnRef}, ${m.poRef}, ${m.vendorId}::uuid,
            ${m.poAmountMinor.toString()}::bigint, ${m.grnAmountMinor.toString()}::bigint)
    ON CONFLICT (tenant_id, grn_ref) DO UPDATE SET
      po_ref           = EXCLUDED.po_ref,
      vendor_id        = EXCLUDED.vendor_id,
      po_amount_minor  = EXCLUDED.po_amount_minor,
      grn_amount_minor = EXCLUDED.grn_amount_minor,
      updated_at       = now()
  `);
}

export async function findGrnMatch(tx: Writer, tenantId: string, grnRef: string): Promise<GrnMatchRow | null> {
  const rows = await (tx as typeof db).select().from(financeGrnMatch)
    .where(and(eq(financeGrnMatch.tenantId, tenantId), eq(financeGrnMatch.grnRef, grnRef)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBillById(id: string): Promise<BillRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)).limit(1));
  return rows[0] ?? null;
}

/** R15: tenant-scoped bill read — no row from another tenant can be returned. */
export async function findBillByIdAndTenant(id: string, tenantId: string): Promise<BillRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBills)
    .where(and(eq(financeBills.id, id), eq(financeBills.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findBillByIdTx(tx: Writer, id: string): Promise<BillRow | null> {
  const rows = await (tx as typeof db).select().from(financeBills).where(eq(financeBills.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findPaymentById(id: string): Promise<PaymentRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financePayments).where(eq(financePayments.id, id)).limit(1));
  return rows[0] ?? null;
}

/** R15: tenant-scoped payment read — no row from another tenant can be returned. */
export async function findPaymentByIdAndTenant(id: string, tenantId: string): Promise<PaymentRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financePayments)
    .where(and(eq(financePayments.id, id), eq(financePayments.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findPaymentByIdTx(tx: Writer, id: string): Promise<PaymentRow | null> {
  const rows = await (tx as typeof db).select().from(financePayments).where(eq(financePayments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updatePayment(tx: Writer, id: string, patch: Partial<PaymentInsert>): Promise<void> {
  await tx.update(financePayments).set({ ...patch, updatedAt: new Date() }).where(eq(financePayments.id, id));
}

export async function insertBill(tx: Writer, row: BillInsert): Promise<void> {
  await tx.insert(financeBills).values(row);
}

export async function updateBill(tx: Writer, id: string, patch: Partial<BillInsert>): Promise<void> {
  await tx.update(financeBills).set({ ...patch, updatedAt: new Date() }).where(eq(financeBills.id, id));
}

export async function listPaymentsByTenant(tenantId: string, limit: number, offset: number): Promise<PaymentRow[]> {
  return scopedRead((tx) => tx.select().from(financePayments)
    .where(eq(financePayments.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function listBillsByTenant(tenantId: string, limit: number): Promise<BillRow[]> {
  return scopedRead((tx) => tx.select().from(financeBills)
    .where(eq(financeBills.tenantId, tenantId))
    .limit(limit));
}

export async function insertPayment(tx: Writer, row: PaymentInsert): Promise<void> {
  await tx.insert(financePayments).values(row);
}

// ── Sample data ("try it") — clearly-marked example bills, safe to clear ──────

const SAMPLE_BILLS: Array<{ billNo: string; grossMinor: bigint; status: string; stage: string }> = [
  { billNo: "[SAMPLE] BILL-001", grossMinor: 1500000n, status: "pending", stage: "section" },
  { billNo: "[SAMPLE] BILL-002", grossMinor: 4200000n, status: "under_review", stage: "audit" },
  { billNo: "[SAMPLE] BILL-003", grossMinor: 980000n, status: "paid", stage: "paid" },
];

export async function countSampleBills(tenantId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ id: financeBills.id }).from(financeBills)
    .where(and(eq(financeBills.tenantId, tenantId), eq(financeBills.isSample, true))));
  return rows.length;
}

/** Add example bills for a tenant (idempotent). Returns number added. */
export async function seedSampleBills(tenantId: string, actorId: string): Promise<number> {
  if ((await countSampleBills(tenantId)) > 0) return 0;
  const now = new Date();
  const rows: BillInsert[] = SAMPLE_BILLS.map((b) => ({
    id: randomUUID(),
    tenantId,
    billNo: b.billNo,
    vendorId: randomUUID(),
    headId: randomUUID(),
    grossMinor: b.grossMinor,
    netMinor: b.grossMinor,
    stage: b.stage,
    status: b.status,
    isSample: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  }));
  await db.transaction(async (tx) => {
    await tx.insert(financeBills).values(rows);
  });
  return rows.length;
}

/** Remove ONLY this tenant's sample bills. Real bills are never touched. */
export async function clearSampleBills(tenantId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const removed = await tx.delete(financeBills)
      .where(and(eq(financeBills.tenantId, tenantId), eq(financeBills.isSample, true)))
      .returning({ id: financeBills.id });
    return removed.length;
  });
}

export async function listAdvancesByTenant(tenantId: string, limit: number): Promise<AdvanceRow[]> {
  return scopedRead((tx) => tx.select().from(financeAdvances)
    .where(eq(financeAdvances.tenantId, tenantId))
    .limit(limit));
}

export async function insertAdvance(tx: Writer, row: AdvanceInsert): Promise<void> {
  await tx.insert(financeAdvances).values(row);
}

export async function findAdvanceByIdTx(tx: Writer, id: string): Promise<AdvanceRow | null> {
  const rows = await (tx as typeof db).select().from(financeAdvances).where(eq(financeAdvances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateAdvance(tx: Writer, id: string, patch: Partial<AdvanceInsert>): Promise<void> {
  await tx.update(financeAdvances).set({ ...patch, updatedAt: new Date() }).where(eq(financeAdvances.id, id));
}

export async function listUCsByTenant(tenantId: string, limit: number): Promise<UCRow[]> {
  return scopedRead((tx) => tx.select().from(financeUC)
    .where(eq(financeUC.tenantId, tenantId))
    .limit(limit));
}

export async function insertUC(tx: Writer, row: UCInsert): Promise<void> {
  await tx.insert(financeUC).values(row);
}

export async function findUCByIdTx(tx: Writer, id: string): Promise<UCRow | null> {
  const rows = await (tx as typeof db).select().from(financeUC).where(eq(financeUC.id, id)).limit(1);
  return rows[0] ?? null;
}

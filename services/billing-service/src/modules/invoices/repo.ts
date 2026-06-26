import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  billingInvoices,
  billingInvoiceItems,
  billingInvoiceApprovals,
  type BillingInvoiceRow,
  type BillingInvoiceInsert,
  type BillingInvoiceItemRow,
  type BillingInvoiceItemInsert,
  type BillingInvoiceApprovalRow,
  type BillingInvoiceApprovalInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertInvoice(tx: Writer, row: BillingInvoiceInsert): Promise<void> {
  await tx.insert(billingInvoices).values(row);
}

export async function insertItem(tx: Writer, row: BillingInvoiceItemInsert): Promise<void> {
  await tx.insert(billingInvoiceItems).values(row);
}

export async function updateInvoice(tx: Writer, id: string, patch: Partial<BillingInvoiceInsert>): Promise<void> {
  await tx.update(billingInvoices).set({ ...patch, updatedAt: new Date() }).where(eq(billingInvoices.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<BillingInvoiceRow | undefined> {
  const rows = await tx.select().from(billingInvoices).where(eq(billingInvoices.id, id)).limit(1);
  return rows[0];
}

export async function findById(id: string): Promise<BillingInvoiceRow | undefined> {
  const rows = await db.select().from(billingInvoices).where(eq(billingInvoices.id, id)).limit(1);
  return rows[0];
}

export async function itemsByInvoice(invoiceId: string, limit = 200): Promise<BillingInvoiceItemRow[]> {
  return db.select().from(billingInvoiceItems).where(eq(billingInvoiceItems.invoiceId, invoiceId)).limit(limit);
}

export async function listByTenant(tenantId: string, limit = 100): Promise<BillingInvoiceRow[]> {
  return db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.tenantId, tenantId))
    .orderBy(desc(billingInvoices.createdAt))
    .limit(limit);
}

/**
 * Atomic, guarded application of a payment to a bill. Adds `amount` to
 * paid_minor and recomputes status, but ONLY when the resulting paid_minor does
 * not exceed total_minor (the WHERE guard) and the bill is in a payable state.
 * Returns the updated row, or undefined when the guard rejected (overpayment,
 * wrong state, or — under redelivery — already fully applied). This makes a
 * redelivered receipt with the same effect a no-op against the bill.
 */
export async function applyPaymentGuarded(
  tx: Writer,
  invoiceId: string,
  amount: bigint,
  actorId: string,
): Promise<BillingInvoiceRow | undefined> {
  const rows = await tx
    .update(billingInvoices)
    .set({
      paidMinor: sql`${billingInvoices.paidMinor} + ${amount}`,
      status: sql`CASE WHEN ${billingInvoices.paidMinor} + ${amount} >= ${billingInvoices.totalMinor}
                       THEN 'paid' ELSE 'partially_paid' END`,
      paidAt: sql`CASE WHEN ${billingInvoices.paidMinor} + ${amount} >= ${billingInvoices.totalMinor}
                       THEN now() ELSE ${billingInvoices.paidAt} END`,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${billingInvoices.version} + 1`,
    })
    .where(
      and(
        eq(billingInvoices.id, invoiceId),
        sql`${billingInvoices.status} IN ('issued','partially_paid')`,
        sql`${billingInvoices.paidMinor} + ${amount} <= ${billingInvoices.totalMinor}`,
      ),
    )
    .returning();
  return rows[0];
}

// ── approvals (maker-checker) ────────────────────────────────────

export async function insertApproval(tx: Writer, row: BillingInvoiceApprovalInsert): Promise<void> {
  await tx.insert(billingInvoiceApprovals).values(row);
}

export async function findApprovalByIdTx(tx: Writer, id: string): Promise<BillingInvoiceApprovalRow | undefined> {
  const rows = await tx.select().from(billingInvoiceApprovals).where(eq(billingInvoiceApprovals.id, id)).limit(1);
  return rows[0];
}

export async function decideApproval(
  tx: Writer,
  id: string,
  patch: { status: "approved" | "rejected"; decidedBy: string; decidedAt: Date; updatedBy: string },
): Promise<void> {
  await tx
    .update(billingInvoiceApprovals)
    .set({ ...patch, updatedAt: new Date(), version: sql`${billingInvoiceApprovals.version} + 1` })
    .where(eq(billingInvoiceApprovals.id, id));
}

export async function approvalsByInvoice(invoiceId: string): Promise<BillingInvoiceApprovalRow[]> {
  return db
    .select()
    .from(billingInvoiceApprovals)
    .where(eq(billingInvoiceApprovals.invoiceId, invoiceId))
    .orderBy(desc(billingInvoiceApprovals.createdAt));
}

/** Sum outstanding (total - paid) across all live (issued/partially_paid/overdue) bills for a tenant. */
export async function outstandingByTenant(tenantId: string): Promise<{ outstandingMinor: bigint; billedMinor: bigint; paidMinor: bigint; openCount: number }> {
  const rows = await db
    .select({
      billed: sql<string>`COALESCE(SUM(${billingInvoices.totalMinor}), 0)`,
      paid: sql<string>`COALESCE(SUM(${billingInvoices.paidMinor}), 0)`,
      outstanding: sql<string>`COALESCE(SUM(${billingInvoices.totalMinor} - ${billingInvoices.paidMinor}), 0)`,
      openCount: sql<string>`COUNT(*)`,
    })
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.tenantId, tenantId),
        sql`${billingInvoices.status} IN ('issued','partially_paid','overdue')`,
      ),
    );
  const r = rows[0]!;
  return {
    billedMinor: BigInt(r.billed),
    paidMinor: BigInt(r.paid),
    outstandingMinor: BigInt(r.outstanding),
    openCount: Number(r.openCount),
  };
}

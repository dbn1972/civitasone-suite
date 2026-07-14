import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { billingPayments, billingGatewayTxns, type BillingPaymentRow, type BillingPaymentInsert, type BillingGatewayTxnInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPayment(tx: Writer, row: BillingPaymentInsert): Promise<void> {
  await tx.insert(billingPayments).values(row);
}

export async function insertGatewayTxn(tx: Writer, row: BillingGatewayTxnInsert): Promise<void> {
  await tx.insert(billingGatewayTxns).values(row);
}

export async function listByInvoice(invoiceId: string, tenantId: string): Promise<BillingPaymentRow[]> {
  return scopedRead((tx) => tx
    .select()
    .from(billingPayments)
    .where(and(eq(billingPayments.invoiceId, invoiceId), eq(billingPayments.tenantId, tenantId)))
    .orderBy(desc(billingPayments.receivedAt)));
}

export async function listByTenant(tenantId: string, limit = 100): Promise<BillingPaymentRow[]> {
  return scopedRead((tx) => tx
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.tenantId, tenantId))
    .orderBy(desc(billingPayments.receivedAt))
    .limit(limit));
}

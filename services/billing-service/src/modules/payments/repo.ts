import { db } from "../../shared/db.js";
import { billingPayments, billingGatewayTxns, type BillingPaymentInsert, type BillingGatewayTxnInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPayment(tx: Writer, row: BillingPaymentInsert): Promise<void> {
  await tx.insert(billingPayments).values(row);
}

export async function insertGatewayTxn(tx: Writer, row: BillingGatewayTxnInsert): Promise<void> {
  await tx.insert(billingGatewayTxns).values(row);
}

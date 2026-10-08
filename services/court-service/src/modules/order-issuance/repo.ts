import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { orders } from "../order/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Read the issuance-relevant state of an existing order for a version-guarded
 * workflow transition. Returns the current status + optimistic-lock version and
 * the maker identity fields (createdBy / signedBy) so the consumer can enforce
 * maker-checker. No insert — orders are created by the base `order` module; this
 * module only advances an existing order through its issuance lifecycle.
 */
export async function getOrderForIssuance(
  tx: Writer, tenantId: string, orderId: string,
): Promise<{ status: string; version: number; createdBy: string | null; signedBy: string | null } | undefined> {
  const rows = await tx.select({
    status:    orders.status,
    version:   orders.version,
    createdBy: orders.createdBy,
    signedBy:  orders.signedBy,
  })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return rows[0];
}

/**
 * Tx-scoped read of the signable content fields (GAP-COURT-ORDERS-02). Used by
 * the issuance consumer to re-verify the DSC inside the SAME transaction that
 * issues the order, so the persisted signer CN / serial / chain-trusted flag
 * are derived from the authoritative committed content, not a cached copy.
 */
export async function getOrderSignableInTx(
  tx: Writer, tenantId: string, orderId: string,
): Promise<{ id: string; caseId: string; orderType: string | null; orderText: string | null; orderDate: string | null } | undefined> {
  const rows = await tx.select({
    id:        orders.id,
    caseId:    orders.caseId,
    orderType: orders.orderType,
    orderText: orders.orderText,
    orderDate: orders.orderDate,
  })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return rows[0];
}

/** Single-row read for a synchronous pre-check before publishing an
 *  issuance-lifecycle command (mirrors getOrderForIssuance's column set,
 *  for the same reason). Deliberately NOT read-through-cached (unlike
 *  order/repo.ts's getOrderById): createdBy/signedBy never change after
 *  creation so staleness can't defeat maker-checker specifically, but a
 *  stale status/version here would let this pre-check wrongly pass or
 *  wrongly reject, reproducing the fake-202 problem it exists to close. */
export async function getOrderForPrecheck(
  tenantId: string, orderId: string,
): Promise<{ status: string; version: number; createdBy: string | null; signedBy: string | null } | undefined> {
  const rows = await scopedRead<Array<{ status: string; version: number; createdBy: string | null; signedBy: string | null }>>((tx) => tx
    .select({
      status:    orders.status,
      version:   orders.version,
      createdBy: orders.createdBy,
      signedBy:  orders.signedBy,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1));
  return rows[0];
}

/**
 * Read the signable content fields of an order (GAP-COURT-ORDERS-02). The DSC
 * signature must cover the ORDER's canonical content, so server-side
 * verification needs the type/text/date (not just status/version/maker). Not
 * cached — the signed content must be read authoritatively, and this is only
 * used on the (infrequent) verify / issue paths.
 */
export async function getOrderForDscVerify(
  tenantId: string, orderId: string,
): Promise<{ id: string; caseId: string; orderType: string | null; orderText: string | null; orderDate: string | null } | undefined> {
  const rows = await scopedRead<Array<{ id: string; caseId: string; orderType: string | null; orderText: string | null; orderDate: string | null }>>((tx) => tx
    .select({
      id:        orders.id,
      caseId:    orders.caseId,
      orderType: orders.orderType,
      orderText: orders.orderText,
      orderDate: orders.orderDate,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1));
  return rows[0];
}

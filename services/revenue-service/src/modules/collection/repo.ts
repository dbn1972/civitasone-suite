import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { receipts, refunds } from "./schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

/** Minimal read handle a caller-supplied transaction must satisfy for the
 * `Tx` siblings below (TX-001) — reused across collection repo functions
 * that need to route through an already-open outer transaction. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listReceipts(tenantId: string, assesseeId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:receipts:${assesseeId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(receipts)
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.assesseeId, assesseeId)))
        .orderBy(desc(receipts.createdAt));
    });
  });
  return rows ?? [];
}

export async function findReceipt(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

/**
 * Fetch a single refund by id, tenant-scoped. Used by the maker-checker
 * decide screen so a checker never approves/rejects blind — the caller
 * needs amountMinor + the reason + who raised it before deciding.
 */
export async function findRefundById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

/**
 * Get the current balance for a demand from the latest DCB entry.
 */
export async function getDemandBalance(tenantId: string, demandId: string): Promise<bigint> {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return getDemandBalanceTx(t, tenantId, demandId);
  });
}

/**
 * TX-001 — tenant-scoped sibling of getDemandBalance(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (collection/consumer.ts's receiptCreate, refundDecide and
 * adjustmentCreate handlers, all of which call this to price a receipt,
 * refund or adjustment before writing) does not open a second, bare
 * tenantTransaction()/db.transaction() from inside itself: under pool.max
 * concurrent in-flight consumer transactions, the nested call has no free
 * connection to open on and deadlocks the pool silently. Route every read
 * that happens inside an already-open consumer transaction through this,
 * not getDemandBalance().
 */
export async function getDemandBalanceTx(tx: Writer, tenantId: string, demandId: string): Promise<bigint> {
  const rows = await tx
    .select({ balanceMinor: dcbEntries.balanceMinor })
    .from(dcbEntries)
    .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.demandId, demandId)))
    .orderBy(desc(dcbEntries.createdAt))
    .limit(1);
  return rows[0]?.balanceMinor ?? 0n;
}

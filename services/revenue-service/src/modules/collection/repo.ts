import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { receipts, refunds, adjustments } from "./schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

/** Minimal read handle a caller-supplied transaction must satisfy for the
 * `Tx` siblings below (TX-001) — reused across collection repo functions
 * that need to route through an already-open outer transaction. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * GAP-REVENUE-ADJUSTMENTS-02: list adjustments for an assessee (newest first)
 * so the officer can see what was moved — previously there was no list
 * endpoint, only POST. Tenant-scoped via tenantTransaction/RLS.
 */
export async function listAdjustments(
  tenantId: string,
  assesseeId: string,
  pagination: { limit: number; offset: number },
) {
  // limit/offset are pushed into SQL and `total` is a real COUNT(*) — a tenant
  // register can be large, so never load every row to slice in memory.
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = and(eq(adjustments.tenantId, tenantId), eq(adjustments.assesseeId, assesseeId));
    const rows = await t
      .select()
      .from(adjustments)
      .where(where)
      .orderBy(desc(adjustments.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(adjustments).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
}

export async function listReceipts(tenantId: string, assesseeId: string, pagination: { limit: number; offset: number }) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = and(eq(receipts.tenantId, tenantId), eq(receipts.assesseeId, assesseeId));
    const rows = await t
      .select()
      .from(receipts)
      .where(where)
      .orderBy(desc(receipts.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(receipts).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
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
 * GAP-REVENUE-REFUNDS-01: list refunds for the tenant, newest first,
 * optionally filtered by status (e.g. ?status=pending so a checker can find
 * refunds awaiting approval without being handed a UUID). Tenant-scoped via
 * tenantTransaction/RLS — a refund amount is sensitive financial data and
 * must never cross tenants.
 */
export async function listRefunds(
  tenantId: string,
  pagination: { limit: number; offset: number },
  status?: string,
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = status
      ? and(eq(refunds.tenantId, tenantId), eq(refunds.status, status))
      : eq(refunds.tenantId, tenantId);
    const rows = await t
      .select()
      .from(refunds)
      .where(where)
      .orderBy(desc(refunds.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(refunds).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
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

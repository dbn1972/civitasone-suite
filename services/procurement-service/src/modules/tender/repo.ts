import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementTenders, procurementTenderBids, procurementTenderFinancialBids,
  type TenderRow, type TenderInsert, type TenderBidRow, type TenderBidInsert,
  type FinancialBidRow, type FinancialBidInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findTenderById(id: string): Promise<TenderRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementTenders).where(eq(procurementTenders.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findTenderByIdTx(tx: Writer, id: string, tenantId: string): Promise<TenderRow | null> {
  const rows = await (tx as typeof db).select().from(procurementTenders)
    .where(and(eq(procurementTenders.id, id), eq(procurementTenders.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listTendersByTenant(tenantId: string, limit: number, offset: number): Promise<TenderRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementTenders)
    .where(eq(procurementTenders.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function findBidsByTender(tenderId: string): Promise<TenderBidRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementTenderBids).where(eq(procurementTenderBids.tenderId, tenderId)));
}

export async function findBidsByTenderTx(tx: Writer, tenderId: string, tenantId: string): Promise<TenderBidRow[]> {
  return (tx as typeof db).select().from(procurementTenderBids)
    .where(and(eq(procurementTenderBids.tenderId, tenderId), eq(procurementTenderBids.tenantId, tenantId)));
}

export async function findBidByIdTx(tx: Writer, id: string, tenantId: string): Promise<TenderBidRow | null> {
  const rows = await (tx as typeof db).select().from(procurementTenderBids)
    .where(and(eq(procurementTenderBids.id, id), eq(procurementTenderBids.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertTender(tx: Writer, row: TenderInsert): Promise<void> {
  await tx.insert(procurementTenders).values(row);
}

export async function updateTenderVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<TenderInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementTenders)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementTenders.id, id), eq(procurementTenders.version, expectedVersion)))
    .returning({ id: procurementTenders.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: tender ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export async function insertBid(tx: Writer, row: TenderBidInsert): Promise<void> {
  await tx.insert(procurementTenderBids).values(row);
}

export async function updateBidVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<TenderBidInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementTenderBids)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementTenderBids.id, id), eq(procurementTenderBids.version, expectedVersion)))
    .returning({ id: procurementTenderBids.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: bid ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

// ── Sealed financial envelope ───────────────────────────────────────────────
export async function insertFinancialBid(tx: Writer, row: FinancialBidInsert): Promise<void> {
  await tx.insert(procurementTenderFinancialBids).values(row);
}

export async function findFinancialBidByBidIdTx(tx: Writer, bidId: string, tenantId: string): Promise<FinancialBidRow | null> {
  const rows = await (tx as typeof db).select().from(procurementTenderFinancialBids)
    .where(and(eq(procurementTenderFinancialBids.bidId, bidId), eq(procurementTenderFinancialBids.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findFinancialBidsByTenderTx(tx: Writer, tenderId: string, tenantId: string): Promise<FinancialBidRow[]> {
  return (tx as typeof db).select().from(procurementTenderFinancialBids)
    .where(and(eq(procurementTenderFinancialBids.tenderId, tenderId), eq(procurementTenderFinancialBids.tenantId, tenantId)));
}

export async function openFinancialBidVersioned(tx: Writer, bidId: string, expectedVersion: number, actorId: string): Promise<void> {
  const res = await (tx as typeof db).update(procurementTenderFinancialBids)
    .set({ sealed: false, openedAt: new Date(), updatedBy: actorId, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementTenderFinancialBids.bidId, bidId), eq(procurementTenderFinancialBids.version, expectedVersion)))
    .returning({ id: procurementTenderFinancialBids.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: financial bid for ${bidId} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export type BidEvaluationRow = {
  bidId: string;
  tenderNo: string;
  vendorName: string;
  technicalScore: number | null;
  financialScore: number | null;
  rank: number | null;
  status: string;
};

/**
 * Cross-tender bid-evaluation register: bids that have entered technical
 * evaluation (technicalScore assigned) — i.e. tender.status IN
 * (technical_evaluation, financial_evaluation, awarded, …). Does NOT touch
 * procurementTenderFinancialBids (sealed amounts) — financialScore here is
 * the evaluation-derived score column on the bid itself, not the raw amount.
 */
export async function listBidEvaluationsByTenant(tenantId: string, limit: number, offset: number): Promise<BidEvaluationRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx
    .select({
      bidId: procurementTenderBids.id,
      tenderNo: procurementTenders.tenderNo,
      vendorName: procurementTenderBids.vendorName,
      technicalScore: procurementTenderBids.technicalScore,
      financialScore: procurementTenderBids.financialScore,
      rank: procurementTenderBids.rank,
      status: procurementTenderBids.status,
    })
    .from(procurementTenderBids)
    .innerJoin(procurementTenders, and(
      eq(procurementTenderBids.tenderId, procurementTenders.id),
      eq(procurementTenders.tenantId, tenantId),
    ))
    .where(and(
      eq(procurementTenderBids.tenantId, tenantId),
      isNotNull(procurementTenderBids.technicalScore),
    ))
    .orderBy(desc(procurementTenderBids.updatedAt))
    .limit(limit)
    .offset(offset));
}

/**
 * READ GUARD: returns the financial amount ONLY for bids whose financial
 * envelope has been opened (sealed=false). Sealed envelopes are withheld — the
 * core two-bid integrity property. Use for pre/post-qualification read paths.
 */
export async function getRevealedFinancials(tenderId: string, tenantId: string): Promise<Array<{ bidId: string; vendorId: string; amountMinor: bigint }>> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementTenderFinancialBids)
    .where(and(
      eq(procurementTenderFinancialBids.tenderId, tenderId),
      eq(procurementTenderFinancialBids.tenantId, tenantId),
      eq(procurementTenderFinancialBids.sealed, false),
    )));
  return rows.map((r) => ({ bidId: r.bidId, vendorId: r.vendorId, amountMinor: r.amountMinor }));
}

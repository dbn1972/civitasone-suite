import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementTenderDocuments, procurementTenderCorrigenda, procurementPrebidQueries,
  type TenderDocRow, type TenderDocInsert,
  type CorrigendumRow, type CorrigendumInsert,
  type PrebidQueryRow, type PrebidQueryInsert,
} from "./docs-schema.js";
import { procurementTenders } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── Documents ────────────────────────────────────────────────────
export async function insertDoc(tx: Writer, row: TenderDocInsert): Promise<void> {
  await tx.insert(procurementTenderDocuments).values(row);
}
export async function updateDoc(tx: Writer, id: string, patch: Partial<TenderDocInsert>): Promise<void> {
  await tx.update(procurementTenderDocuments).set({ ...patch, updatedAt: new Date() }).where(eq(procurementTenderDocuments.id, id));
}
export async function findCurrentDocTx(tx: Writer, tenderId: string, tenantId: string, docType: string): Promise<TenderDocRow | null> {
  const rows = await (tx as typeof db).select().from(procurementTenderDocuments)
    .where(and(
      eq(procurementTenderDocuments.tenderId, tenderId),
      eq(procurementTenderDocuments.tenantId, tenantId),
      eq(procurementTenderDocuments.docType, docType),
      eq(procurementTenderDocuments.isCurrent, true),
    )).limit(1);
  return rows[0] ?? null;
}
export async function listDocsByTender(tenderId: string, tenantId: string): Promise<TenderDocRow[]> {
  return db.transaction((tx) => tx.select().from(procurementTenderDocuments)
    .where(and(eq(procurementTenderDocuments.tenderId, tenderId), eq(procurementTenderDocuments.tenantId, tenantId))));
}

// ── Corrigenda ───────────────────────────────────────────────────
export async function insertCorrigendum(tx: Writer, row: CorrigendumInsert): Promise<void> {
  await tx.insert(procurementTenderCorrigenda).values(row);
}
export async function updateCorrigendum(tx: Writer, id: string, patch: Partial<CorrigendumInsert>): Promise<void> {
  await tx.update(procurementTenderCorrigenda).set({ ...patch, updatedAt: new Date() }).where(eq(procurementTenderCorrigenda.id, id));
}
export async function findCorrigendumByIdTx(tx: Writer, id: string, tenantId: string): Promise<CorrigendumRow | null> {
  const rows = await (tx as typeof db).select().from(procurementTenderCorrigenda)
    .where(and(eq(procurementTenderCorrigenda.id, id), eq(procurementTenderCorrigenda.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function maxCorrigendumNoTx(tx: Writer, tenderId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).select({ n: sql<number>`COALESCE(MAX(${procurementTenderCorrigenda.corrigendumNo}), 0)` })
    .from(procurementTenderCorrigenda)
    .where(and(eq(procurementTenderCorrigenda.tenderId, tenderId), eq(procurementTenderCorrigenda.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}
export async function listCorrigendaByTender(tenderId: string, tenantId: string): Promise<CorrigendumRow[]> {
  return db.transaction((tx) => tx.select().from(procurementTenderCorrigenda)
    .where(and(eq(procurementTenderCorrigenda.tenderId, tenderId), eq(procurementTenderCorrigenda.tenantId, tenantId)))
    .orderBy(procurementTenderCorrigenda.corrigendumNo));
}

// ── Pre-bid queries ──────────────────────────────────────────────
export async function insertPrebidQuery(tx: Writer, row: PrebidQueryInsert): Promise<void> {
  await tx.insert(procurementPrebidQueries).values(row);
}
export async function updatePrebidQuery(tx: Writer, id: string, patch: Partial<PrebidQueryInsert>): Promise<void> {
  await tx.update(procurementPrebidQueries).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPrebidQueries.id, id));
}
export async function findPrebidQueryByIdTx(tx: Writer, id: string, tenantId: string): Promise<PrebidQueryRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPrebidQueries)
    .where(and(eq(procurementPrebidQueries.id, id), eq(procurementPrebidQueries.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function maxQueryNoTx(tx: Writer, tenderId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).select({ n: sql<number>`COALESCE(MAX(${procurementPrebidQueries.queryNo}), 0)` })
    .from(procurementPrebidQueries)
    .where(and(eq(procurementPrebidQueries.tenderId, tenderId), eq(procurementPrebidQueries.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}
export async function listPrebidQueriesByTender(tenderId: string, tenantId: string): Promise<PrebidQueryRow[]> {
  return db.transaction((tx) => tx.select().from(procurementPrebidQueries)
    .where(and(eq(procurementPrebidQueries.tenderId, tenderId), eq(procurementPrebidQueries.tenantId, tenantId)))
    .orderBy(procurementPrebidQueries.queryNo));
}

export type PrebidAggregateRow = {
  tenderId: string;
  tenderNo: string;
  firstQueryAt: string;
  queriesRaised: number;
  responses: number;
  publishedCount: number;
};

/**
 * Cross-tender pre-bid-query aggregate, grouped by tender — this system
 * models pre-bid Q&A as threaded text queries (procurementPrebidQueries),
 * NOT scheduled meetings, so there is no attendee/date-of-meeting concept to
 * report; callers surface that honestly via meta.reason rather than
 * fabricating attendance figures.
 */
export async function listPrebidAggregatesByTenant(tenantId: string, limit: number, offset: number): Promise<PrebidAggregateRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx
    .select({
      tenderId: procurementPrebidQueries.tenderId,
      tenderNo: procurementTenders.tenderNo,
      firstQueryAt: sql<string>`MIN(${procurementPrebidQueries.createdAt})`,
      queriesRaised: sql<number>`COUNT(*)`,
      responses: sql<number>`COUNT(${procurementPrebidQueries.answer})`,
      publishedCount: sql<number>`COUNT(*) FILTER (WHERE ${procurementPrebidQueries.published})`,
    })
    .from(procurementPrebidQueries)
    .innerJoin(procurementTenders, and(
      eq(procurementPrebidQueries.tenderId, procurementTenders.id),
      eq(procurementTenders.tenantId, tenantId),
    ))
    .where(eq(procurementPrebidQueries.tenantId, tenantId))
    .groupBy(procurementPrebidQueries.tenderId, procurementTenders.tenderNo)
    .orderBy(desc(sql`MIN(${procurementPrebidQueries.createdAt})`))
    .limit(limit)
    .offset(offset));
}

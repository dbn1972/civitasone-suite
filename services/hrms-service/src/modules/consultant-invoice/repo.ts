import { eq, and, desc, ne, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsConsultantInvoices,
  type ConsultantInvoiceRow, type ConsultantInvoiceInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type Reader = Pick<typeof db, "select">;
type TxExec = { execute: (q: SQL) => Promise<unknown> };

export async function insertInvoice(tx: Writer, row: ConsultantInvoiceInsert): Promise<void> {
  await tx.insert(hrmsConsultantInvoices).values(row);
}

export async function findInvoice(tenantId: string, id: string): Promise<ConsultantInvoiceRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsConsultantInvoices)
    .where(and(eq(hrmsConsultantInvoices.tenantId, tenantId), eq(hrmsConsultantInvoices.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listByConsultant(tenantId: string, consultantId: string, limit = 200): Promise<ConsultantInvoiceRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsConsultantInvoices)
    .where(and(eq(hrmsConsultantInvoices.tenantId, tenantId), eq(hrmsConsultantInvoices.consultantId, consultantId)))
    .orderBy(desc(hrmsConsultantInvoices.submittedAt))
    .limit(limit));
}

export async function listByStatus(tenantId: string, status: string, limit = 200): Promise<ConsultantInvoiceRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsConsultantInvoices)
    .where(and(eq(hrmsConsultantInvoices.tenantId, tenantId), eq(hrmsConsultantInvoices.status, status)))
    .orderBy(desc(hrmsConsultantInvoices.submittedAt))
    .limit(limit));
}

/**
 * Sum of gross professional fees the consultant already has APPROVED or PAID
 * within the given financial-year window [fyFrom, fyTo], excluding the invoice
 * being decided (`excludeId`). Feeds the 194J threshold test at approval time.
 * Draft/submitted/verified/rejected are NOT counted — only amounts that have
 * actually crossed approval (are legally "paid or credited").
 */
function ytdConds(tenantId: string, consultantId: string, fyFrom: string, fyTo: string, excludeId?: string) {
  const conds = [
    eq(hrmsConsultantInvoices.tenantId, tenantId),
    eq(hrmsConsultantInvoices.consultantId, consultantId),
    sql`${hrmsConsultantInvoices.status} IN ('approved','paid')`,
    gte(hrmsConsultantInvoices.invoiceDate, fyFrom),
    lte(hrmsConsultantInvoices.invoiceDate, fyTo),
  ];
  if (excludeId) conds.push(ne(hrmsConsultantInvoices.id, excludeId));
  return conds;
}

async function ytdOn(reader: Reader, tenantId: string, consultantId: string, fyFrom: string, fyTo: string, excludeId?: string): Promise<bigint> {
  const rows = await reader
    .select({ total: sql<string>`COALESCE(SUM(${hrmsConsultantInvoices.grossMinor}), 0)` })
    .from(hrmsConsultantInvoices)
    .where(and(...ytdConds(tenantId, consultantId, fyFrom, fyTo, excludeId)));
  return BigInt(rows[0]?.total ?? "0");
}

export async function ytdApprovedGross(
  tenantId: string, consultantId: string, fyFrom: string, fyTo: string, excludeId?: string,
): Promise<bigint> {
  return scopedRead((tx) => ytdOn(tx as Reader, tenantId, consultantId, fyFrom, fyTo, excludeId));
}

/** Same YTD aggregate but reading through an already-open (locked) transaction. */
export async function ytdApprovedGrossTx(
  tx: Reader, tenantId: string, consultantId: string, fyFrom: string, fyTo: string, excludeId?: string,
): Promise<bigint> {
  return ytdOn(tx, tenantId, consultantId, fyFrom, fyTo, excludeId);
}

/**
 * Take a transaction-scoped advisory lock keyed on (tenant, consultant) so that
 * invoice approvals for one consultant serialize — preventing two concurrent
 * approvals from each reading a pre-threshold YTD total and both under-deducting
 * 194J. Auto-released at commit/rollback.
 */
export async function lockConsultantForInvoicing(tx: TxExec, tenantId: string, consultantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${consultantId}`}, 0))`);
}

export async function updateInvoice(
  tx: Writer, tenantId: string, id: string, patch: Partial<ConsultantInvoiceInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsConsultantInvoices)
    .set({ ...patch, version: sql`${hrmsConsultantInvoices.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsConsultantInvoices.tenantId, tenantId),
      eq(hrmsConsultantInvoices.id, id),
      eq(hrmsConsultantInvoices.version, expectedVersion),
    ));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "invoice was modified by another request; reload and retry");
  }
}

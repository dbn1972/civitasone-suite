import { and, desc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financeAuditParas, type AuditParaInsert, type AuditParaRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAuditPara(tx: Writer, row: AuditParaInsert): Promise<void> {
  await tx.insert(financeAuditParas).values(row);
}

/** Insert unless (tenant_id, para_no) already exists; true when a row was written. */
export async function insertAuditParaIfAbsent(tx: Writer, row: AuditParaInsert): Promise<boolean> {
  const rows = await tx.insert(financeAuditParas).values(row)
    .onConflictDoNothing({ target: [financeAuditParas.tenantId, financeAuditParas.paraNo] })
    .returning({ id: financeAuditParas.id });
  return rows.length > 0;
}

export type ListAuditParasFilters = { status?: string; source?: string; limit: number };

/** Tenant-scoped listing, most recently created first. */
export async function listAuditParas(tenantId: string, filters: ListAuditParasFilters): Promise<AuditParaRow[]> {
  return scopedRead(async (tx) => {
    const conds = [eq(financeAuditParas.tenantId, tenantId)];
    if (filters.status) conds.push(eq(financeAuditParas.status, filters.status));
    if (filters.source) conds.push(eq(financeAuditParas.source, filters.source));
    return tx
      .select()
      .from(financeAuditParas)
      .where(and(...conds))
      .orderBy(desc(financeAuditParas.createdAt))
      .limit(filters.limit);
  });
}

/** Tenant-scoped single lookup; null when absent or owned by another tenant. */
export async function getAuditParaById(tenantId: string, id: string): Promise<AuditParaRow | null> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(financeAuditParas)
      .where(and(eq(financeAuditParas.tenantId, tenantId), eq(financeAuditParas.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

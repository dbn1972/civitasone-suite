/**
 * code-list repository (CAP-017). RLS policy allows a tenant to read its own
 * rows plus platform-global (tenant_id IS NULL) rows; all reads run under the
 * tenant GUC. Lookups resolve a list by code preferring the tenant's own list
 * over the global fallback.
 */
import { and, eq, isNull, or, asc, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { activeSql } from "../../shared/effective-dating.js";
import { codeLists, codeValues, type CodeListRow, type CodeValueRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

/** Tenant lists + global lists (RLS returns both). */
export function listLists(tenantId: string): Promise<CodeListRow[]> {
  return scoped(tenantId, (tx) =>
    tx.select().from(codeLists)
      .where(or(eq(codeLists.tenantId, tenantId), isNull(codeLists.tenantId)))
      .orderBy(codeLists.code));
}

/** Resolve a list by code, preferring the tenant's own over the global one. */
export async function resolveListTx(tx: Tx, tenantId: string, code: string): Promise<CodeListRow | undefined> {
  const rows = await tx.select().from(codeLists)
    .where(and(eq(codeLists.code, code), or(eq(codeLists.tenantId, tenantId), isNull(codeLists.tenantId))))
    // tenant-owned first (tenant_id NOT NULL sorts before NULL with NULLS LAST)
    .orderBy(sql`${codeLists.tenantId} NULLS LAST`)
    .limit(1);
  return rows[0];
}

export function resolveList(tenantId: string, code: string): Promise<CodeListRow | undefined> {
  return scoped(tenantId, (tx) => resolveListTx(tx, tenantId, code));
}

/** Active (currently-effective) values for a resolved list. */
export function lookupActiveValues(tenantId: string, code: string): Promise<CodeValueRow[] | null> {
  return scoped(tenantId, async (tx) => {
    const list = await resolveListTx(tx, tenantId, code);
    if (!list) return null;
    // Effective-dated point-in-time read via the shared CAP-018 helper.
    return tx.select().from(codeValues)
      .where(and(eq(codeValues.listId, list.id), eq(codeValues.isActive, true),
        activeSql(codeValues.effectiveFrom, codeValues.effectiveTo)))
      .orderBy(asc(codeValues.sortOrder), asc(codeValues.code));
  });
}

export async function insertList(tx: Tx, data: typeof codeLists.$inferInsert): Promise<void> {
  await tx.insert(codeLists).values(data);
}
export async function insertValue(tx: Tx, data: typeof codeValues.$inferInsert): Promise<void> {
  await tx.insert(codeValues).values(data);
}
export async function findActiveValueTx(tx: Tx, tenantId: string, listId: string, code: string): Promise<CodeValueRow | undefined> {
  const rows = await tx.select().from(codeValues)
    .where(and(eq(codeValues.tenantId, tenantId), eq(codeValues.listId, listId), eq(codeValues.code, code), isNull(codeValues.effectiveTo)))
    .limit(1);
  return rows[0];
}
export async function closeValue(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(codeValues).set({ effectiveTo: at }).where(eq(codeValues.id, id));
}

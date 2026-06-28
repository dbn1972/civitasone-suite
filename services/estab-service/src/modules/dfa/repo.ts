import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabDfa } from "./schema.js";
import type { DfaRow, DfaInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findDfaById(id: string, tenantId: string): Promise<DfaRow | null> {
  const rows = await db.select().from(estabDfa)
    .where(and(eq(estabDfa.id, id), eq(estabDfa.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listDfa(
  tenantId: string,
  filter: { status?: string | undefined; fileId?: string | undefined },
  limit: number,
): Promise<DfaRow[]> {
  const rows = await db.select().from(estabDfa)
    .where(eq(estabDfa.tenantId, tenantId))
    .orderBy(desc(estabDfa.createdAt))
    .limit(limit);
  return rows
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .filter((r) => (filter.fileId ? r.fileId === filter.fileId : true));
}

export async function insertDfa(tx: Writer, row: DfaInsert): Promise<void> {
  await tx.insert(estabDfa).values(row);
}

export async function updateDfa(tx: Writer, id: string, patch: Partial<DfaInsert>): Promise<void> {
  await tx.update(estabDfa).set({ ...patch, updatedAt: new Date() }).where(eq(estabDfa.id, id));
}

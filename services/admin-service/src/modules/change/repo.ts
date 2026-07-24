import { and, desc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  changeRequests,
  changeFreezes,
  changeAudit,
  type ChangeRequestRow,
  type ChangeRequestInsert,
  type ChangeFreezeRow,
  type ChangeFreezeInsert,
  type ChangeAuditInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── change requests ────────────────────────────────────────────────────────

export async function insertRequest(tx: Writer, row: ChangeRequestInsert): Promise<void> {
  await tx.insert(changeRequests).values(row);
}

export async function listRequests(tenantId: string, limit: number): Promise<ChangeRequestRow[]> {
  return scopedRead((tx) => tx.select().from(changeRequests)
    .where(eq(changeRequests.tenantId, tenantId))
    .orderBy(desc(changeRequests.createdAt))
    .limit(limit));
}

export async function findRequestById(id: string, tenantId: string): Promise<ChangeRequestRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(changeRequests)
    .where(and(eq(changeRequests.id, id), eq(changeRequests.tenantId, tenantId)))
    .limit(1));
  return rows[0];
}

/** Transaction-scoped read used by the mutating routes to load-then-update atomically. */
export async function findRequestByIdTx(tx: Writer, id: string, tenantId: string): Promise<ChangeRequestRow | undefined> {
  const rows = await tx.select().from(changeRequests)
    .where(and(eq(changeRequests.id, id), eq(changeRequests.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function updateRequest(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<ChangeRequestInsert>,
): Promise<void> {
  await tx.update(changeRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.tenantId, tenantId)));
}

// ── audit trail ──────────────────────────────────────────────────────────────

export async function insertAudit(tx: Writer, row: ChangeAuditInsert): Promise<void> {
  await tx.insert(changeAudit).values(row);
}

export async function listAudit(tenantId: string, changeId: string): Promise<Array<typeof changeAudit.$inferSelect>> {
  return scopedRead((tx) => tx.select().from(changeAudit)
    .where(and(eq(changeAudit.tenantId, tenantId), eq(changeAudit.changeId, changeId)))
    .orderBy(changeAudit.at));
}

// ── freezes ──────────────────────────────────────────────────────────────────

export async function insertFreeze(tx: Writer, row: ChangeFreezeInsert): Promise<void> {
  await tx.insert(changeFreezes).values(row);
}

export async function listFreezes(tenantId: string): Promise<ChangeFreezeRow[]> {
  return scopedRead((tx) => tx.select().from(changeFreezes)
    .where(eq(changeFreezes.tenantId, tenantId))
    .orderBy(changeFreezes.startsAt));
}

/** All freezes for a tenant, read inside an open transaction (freeze-conflict check). */
export async function listFreezesTx(tx: Writer, tenantId: string): Promise<ChangeFreezeRow[]> {
  return tx.select().from(changeFreezes).where(eq(changeFreezes.tenantId, tenantId));
}

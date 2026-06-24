import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementEmd, procurementPbg, type EmdRow, type EmdInsert, type PbgRow, type PbgInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── EMD ─────────────────────────────────────────────────────────────────────
export async function insertEmd(tx: Writer, row: EmdInsert): Promise<void> {
  await tx.insert(procurementEmd).values(row);
}
export async function findEmdByIdTx(tx: Writer, id: string, tenantId: string): Promise<EmdRow | null> {
  const rows = await (tx as typeof db).select().from(procurementEmd)
    .where(and(eq(procurementEmd.id, id), eq(procurementEmd.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function findEmdById(id: string, tenantId: string): Promise<EmdRow | null> {
  const rows = await db.select().from(procurementEmd)
    .where(and(eq(procurementEmd.id, id), eq(procurementEmd.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function listEmdByTenant(tenantId: string, limit = 50, offset = 0): Promise<EmdRow[]> {
  return db.select().from(procurementEmd).where(eq(procurementEmd.tenantId, tenantId)).limit(limit).offset(offset);
}
export async function updateEmdVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<EmdInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementEmd)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementEmd.id, id), eq(procurementEmd.version, expectedVersion)))
    .returning({ id: procurementEmd.id });
  if (res.length === 0) throw new Error(`OPTIMISTIC_LOCK_CONFLICT: emd ${id} (expected version ${expectedVersion})`);
}

// ── PBG ─────────────────────────────────────────────────────────────────────
export async function insertPbg(tx: Writer, row: PbgInsert): Promise<void> {
  await tx.insert(procurementPbg).values(row);
}
export async function findPbgByIdTx(tx: Writer, id: string, tenantId: string): Promise<PbgRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPbg)
    .where(and(eq(procurementPbg.id, id), eq(procurementPbg.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function findPbgById(id: string, tenantId: string): Promise<PbgRow | null> {
  const rows = await db.select().from(procurementPbg)
    .where(and(eq(procurementPbg.id, id), eq(procurementPbg.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function listPbgByTenant(tenantId: string, limit = 50, offset = 0): Promise<PbgRow[]> {
  return db.select().from(procurementPbg).where(eq(procurementPbg.tenantId, tenantId)).limit(limit).offset(offset);
}
export async function updatePbgVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<PbgInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementPbg)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementPbg.id, id), eq(procurementPbg.version, expectedVersion)))
    .returning({ id: procurementPbg.id });
  if (res.length === 0) throw new Error(`OPTIMISTIC_LOCK_CONFLICT: pbg ${id} (expected version ${expectedVersion})`);
}

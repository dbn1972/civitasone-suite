/**
 * settings repo — Drizzle queries against `settings.*` ONLY (L2).
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tenantSettings, type SettingRow, type SettingInsert } from "./schema.js";

export interface SettingView {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  updatedBy: string;
  updatedAt: Date;
  version: number;
}

function toView(r: SettingRow): SettingView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    key: r.key,
    value: r.value,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
    version: r.version,
  };
}

// ── reads (query path) ───────────────────────────────────────────────
export async function findByTenantAndKey(tenantId: string, key: string): Promise<SettingView | null> {
  const rows = await db.select().from(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findAllByTenant(tenantId: string): Promise<SettingView[]> {
  const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
  return rows.map(toView);
}

export async function findById(id: string): Promise<SettingView | null> {
  const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

// ── writes (consumer only, within a tx) ──────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function insert(tx: Writer, row: SettingInsert): Promise<void> {
  await tx.insert(tenantSettings).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SettingInsert>): Promise<void> {
  await tx.update(tenantSettings).set({ ...patch, updatedAt: new Date() }).where(eq(tenantSettings.id, id));
}

export async function deleteByTenantAndKey(tx: Writer, tenantId: string, key: string): Promise<void> {
  await tx.delete(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)));
}

export async function findByTenantAndKeyTx(tx: Writer, tenantId: string, key: string): Promise<SettingView | null> {
  const rows = await tx.select().from(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

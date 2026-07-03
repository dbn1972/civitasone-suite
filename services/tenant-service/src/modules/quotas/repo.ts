/**
 * quotas repo — Drizzle queries against `quotas.*` ONLY (L2).
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { quotas, type QuotaRow, type QuotaInsert } from "./schema.js";

export type QuotaResource = "users" | "storage_gb" | "api_calls_daily" | "documents";

export interface QuotaView {
  id: string;
  tenantId: string;
  resource: QuotaResource;
  limit: number;
  used: number;
  updatedAt: Date;
  version: number;
}

function toView(r: QuotaRow): QuotaView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    resource: r.resource,
    limit: r.limit,
    used: r.used,
    updatedAt: r.updatedAt,
    version: r.version,
  };
}

// ── domain logic ─────────────────────────────────────────────────────
export function isOverLimit(quota: QuotaView): boolean {
  return quota.used >= quota.limit;
}

export function usagePercent(quota: QuotaView): number {
  if (quota.limit === 0) return 100;
  return Math.round((quota.used / quota.limit) * 100);
}

export function projectedOverageDate(
  quota: QuotaView,
  dailyGrowthRate: number,
): Date | null {
  if (quota.used >= quota.limit) return new Date(); // already over
  if (dailyGrowthRate <= 0) return null; // never
  const remaining = quota.limit - quota.used;
  const daysUntilOver = Math.ceil(remaining / dailyGrowthRate);
  const overage = new Date();
  overage.setDate(overage.getDate() + daysUntilOver);
  return overage;
}

// ── reads (query path) ───────────────────────────────────────────────
export async function findById(id: string): Promise<QuotaView | null> {
  const rows = await db.select().from(quotas).where(eq(quotas.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantAndResource(tenantId: string, resource: QuotaResource): Promise<QuotaView | null> {
  const rows = await db.select().from(quotas)
    .where(and(eq(quotas.tenantId, tenantId), eq(quotas.resource, resource)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findAllByTenant(tenantId: string): Promise<QuotaView[]> {
  const rows = await db.select().from(quotas).where(eq(quotas.tenantId, tenantId));
  return rows.map(toView);
}

// ── writes (consumer only, within a tx) ──────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: QuotaInsert): Promise<void> {
  await tx.insert(quotas).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<QuotaInsert>): Promise<void> {
  await tx.update(quotas).set({ ...patch, updatedAt: new Date() }).where(eq(quotas.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<QuotaView | null> {
  const rows = await tx.select().from(quotas).where(eq(quotas.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantAndResourceTx(tx: Writer, tenantId: string, resource: QuotaResource): Promise<QuotaView | null> {
  const rows = await tx.select().from(quotas)
    .where(and(eq(quotas.tenantId, tenantId), eq(quotas.resource, resource)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

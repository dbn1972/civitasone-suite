import { eq, and, lte, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { retentionPolicies, type RetentionPolicyRow, type RetentionPolicyInsert, type RetentionPolicyView } from "./schema.js";

const RESOURCE = "retention-policy";

export function toView(r: RetentionPolicyRow): RetentionPolicyView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    categoryId: r.categoryId,
    retentionYears: r.retentionYears,
    retentionDays: r.retentionDays,
    action: r.action,
    notifyBefore: r.notifyBefore,
    reminderMonths: r.reminderMonths,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<RetentionPolicyView[]> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await db.select().from(retentionPolicies)
      .where(eq(retentionPolicies.tenantId, tenantId))
      .orderBy(desc(retentionPolicies.updatedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toView);
  });
}

export async function getById(tenantId: string, id: string): Promise<RetentionPolicyView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await db.select().from(retentionPolicies)
      .where(and(eq(retentionPolicies.id, id), eq(retentionPolicies.tenantId, tenantId)));
    if (!rows.length) return null;
    return toView(rows[0]!);
  });
}

/**
 * List policies whose documents are approaching expiration.
 * A policy is "expiring" if reminderMonths before retentionYears have passed
 * for documents in the category.
 */
export async function listExpiring(tenantId: string, limit: number, offset: number): Promise<RetentionPolicyView[]> {
  const rows = await db.select().from(retentionPolicies)
    .where(eq(retentionPolicies.tenantId, tenantId))
    .orderBy(retentionPolicies.retentionYears)
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: RetentionPolicyInsert): Promise<void> {
  await tx.insert(retentionPolicies).values(row);
}

export async function update(tx: Writer, id: string, data: Partial<RetentionPolicyInsert>): Promise<void> {
  await tx.update(retentionPolicies).set(data).where(eq(retentionPolicies.id, id));
}

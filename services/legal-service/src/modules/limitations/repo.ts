import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { limitationRules } from "./schema.js";
import type { LimitationRuleRow, LimitationRuleInsert } from "./schema.js";

export async function findById(id: string): Promise<LimitationRuleRow | undefined> {
  const rows = await db.select().from(limitationRules).where(eq(limitationRules.id, id)).limit(1);
  return rows[0];
}

export async function findByIdTx(tx: typeof db, id: string): Promise<LimitationRuleRow | undefined> {
  const rows = await tx.select().from(limitationRules).where(eq(limitationRules.id, id)).limit(1);
  return rows[0];
}

export async function list(
  tenantId: string,
  filters: { matterId?: string | undefined; status?: string | undefined },
  page: number,
  pageSize: number,
): Promise<{ data: LimitationRuleRow[]; total: number }> {
  const conditions = [eq(limitationRules.tenantId, tenantId)];
  if (filters.matterId) conditions.push(eq(limitationRules.matterId, filters.matterId));
  if (filters.status) conditions.push(eq(limitationRules.status, filters.status));

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  const [data, countResult] = await Promise.all([
    db.select().from(limitationRules).where(where).limit(pageSize).offset(offset).orderBy(limitationRules.deadline),
    db.select({ count: sql<number>`count(*)::int` }).from(limitationRules).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: typeof db, values: LimitationRuleInsert): Promise<void> {
  await tx.insert(limitationRules).values(values);
}

export async function update(tx: typeof db, id: string, values: Partial<LimitationRuleInsert>): Promise<void> {
  await tx.update(limitationRules).set({ ...values, updatedAt: new Date() }).where(eq(limitationRules.id, id));
}

export async function softDelete(tx: typeof db, id: string, actorId: string): Promise<void> {
  await tx
    .update(limitationRules)
    .set({ status: "cancelled", updatedBy: actorId, updatedAt: new Date() })
    .where(eq(limitationRules.id, id));
}

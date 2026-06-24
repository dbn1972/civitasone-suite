import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { slaRules, type SlaRuleRow, type SlaRuleInsert } from "./schema.js";

/** Upsert by (tenant_id, priority) so re-posting a priority updates in place. */
export async function upsertRule(row: SlaRuleInsert): Promise<SlaRuleRow> {
  const [out] = await db.insert(slaRules).values(row)
    .onConflictDoUpdate({
      target: [slaRules.tenantId, slaRules.priority],
      set: {
        escalationHours: row.escalationHours,
        escalateTo: row.escalateTo,
        isActive: row.isActive ?? true,
      },
    })
    .returning();
  return out!;
}

export async function listActiveRules(tenantId: string, limit: number, offset: number): Promise<SlaRuleRow[]> {
  return db.select().from(slaRules)
    .where(and(eq(slaRules.tenantId, tenantId), eq(slaRules.isActive, true)))
    .orderBy(desc(slaRules.createdAt))
    .limit(limit).offset(offset);
}

export async function countActiveRules(tenantId: string): Promise<number> {
  const rows = await db.select({ id: slaRules.id }).from(slaRules)
    .where(and(eq(slaRules.tenantId, tenantId), eq(slaRules.isActive, true)));
  return rows.length;
}

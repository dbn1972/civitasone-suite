import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { slaRules, type SlaRuleRow, type SlaRuleInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Upsert by (tenant_id, priority) so re-posting a priority updates in place. */
export async function upsertRuleTx(tx: Writer, row: SlaRuleInsert): Promise<SlaRuleRow> {
  const [out] = await tx.insert(slaRules).values(row)
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

/** Upsert by (tenant_id, priority) so re-posting a priority updates in place. */
export async function upsertRule(row: SlaRuleInsert): Promise<SlaRuleRow> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this write — a bare db.insert() runs with no RLS GUC set.
  return db.transaction((tx) => upsertRuleTx(tx, row));
}

export async function listActiveRules(tenantId: string, limit: number, offset: number): Promise<SlaRuleRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(slaRules)
    .where(and(eq(slaRules.tenantId, tenantId), eq(slaRules.isActive, true)))
    .orderBy(desc(slaRules.createdAt))
    .limit(limit).offset(offset));
}

export async function countActiveRules(tenantId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select({ id: slaRules.id }).from(slaRules)
    .where(and(eq(slaRules.tenantId, tenantId), eq(slaRules.isActive, true))));
  return rows.length;
}

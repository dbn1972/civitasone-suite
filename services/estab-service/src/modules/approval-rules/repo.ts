import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabApprovalRule } from "./schema.js";
import type { ApprovalRuleRow, ApprovalRuleInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findRuleById(id: string, tenantId: string): Promise<ApprovalRuleRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabApprovalRule)
    .where(and(eq(estabApprovalRule.id, id), eq(estabApprovalRule.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listRules(tenantId: string): Promise<ApprovalRuleRow[]> {
  return db.transaction((tx) => tx.select().from(estabApprovalRule)
    .where(eq(estabApprovalRule.tenantId, tenantId))
    .orderBy(asc(estabApprovalRule.sourceType), asc(estabApprovalRule.minAmountMinor)));
}

/** Active rules for a single source type, ordered by band (used by the resolver). */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listActiveRulesForSource(tenantId: string, sourceType: string): Promise<ApprovalRuleRow[]> {
  return db.transaction((tx) => tx.select().from(estabApprovalRule)
    .where(and(
      eq(estabApprovalRule.tenantId, tenantId),
      eq(estabApprovalRule.sourceType, sourceType),
      eq(estabApprovalRule.active, true),
    ))
    .orderBy(asc(estabApprovalRule.minAmountMinor), asc(estabApprovalRule.priority)));
}

export async function insertRule(tx: Writer, row: ApprovalRuleInsert): Promise<void> {
  await tx.insert(estabApprovalRule).values(row);
}

export async function updateRule(tx: Writer, id: string, patch: Partial<ApprovalRuleInsert>): Promise<void> {
  await tx.update(estabApprovalRule)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(estabApprovalRule.id, id));
}

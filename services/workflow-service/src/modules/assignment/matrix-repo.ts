import { eq, and, lte, isNull, or, gte, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { evaluateCondition } from "../../shared/condition.js";
import { responsibilityMatrix, substitutionRules } from "./schema.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update" | "execute">;

// ─── Responsibility Matrix ──────────────────────────────────────────────────

export async function insertMatrixRule(
  tx: Writer,
  row: {
    tenantId: string;
    roleRef: string;
    conditionExpr: string | null;
    userId: string;
    priority: number;
  },
) {
  const [inserted] = await (tx as typeof db)
    .insert(responsibilityMatrix)
    .values({
      tenantId: row.tenantId,
      roleRef: row.roleRef,
      conditionExpr: row.conditionExpr,
      userId: row.userId,
      priority: row.priority,
    })
    .returning();
  return inserted;
}

export async function listMatrixRules(
  tenantId: string,
  roleRef?: string | null,
  limit = 200,
) {
  const conditions = [
    eq(responsibilityMatrix.tenantId, tenantId),
    eq(responsibilityMatrix.active, true),
  ];
  if (roleRef) {
    conditions.push(eq(responsibilityMatrix.roleRef, roleRef));
  }
  return scopedRead((tx) => (tx as typeof db)
    .select()
    .from(responsibilityMatrix)
    .where(and(...conditions))
    .orderBy(asc(responsibilityMatrix.priority))
    .limit(limit));
}

export async function deactivateMatrixRule(
  tx: Writer,
  id: string,
  tenantId: string,
) {
  const [updated] = await (tx as typeof db)
    .update(responsibilityMatrix)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(responsibilityMatrix.id, id), eq(responsibilityMatrix.tenantId, tenantId)))
    .returning();
  return updated ?? null;
}

/**
 * Evaluate condition_expr for each active matrix rule (ordered by priority).
 * Return the first matching user_id.
 */
export async function resolveFromMatrix(
  tx: Writer,
  tenantId: string,
  roleRef: string,
  context: Record<string, unknown>,
): Promise<string | null> {
  const rules = await (tx as typeof db)
    .select()
    .from(responsibilityMatrix)
    .where(
      and(
        eq(responsibilityMatrix.tenantId, tenantId),
        eq(responsibilityMatrix.roleRef, roleRef),
        eq(responsibilityMatrix.active, true),
      ),
    )
    .orderBy(asc(responsibilityMatrix.priority));

  for (const rule of rules) {
    if (evaluateCondition(rule.conditionExpr, context)) {
      return rule.userId;
    }
  }
  return null;
}

// ─── Substitution Rules ─────────────────────────────────────────────────────

export async function insertSubstitution(
  tx: Writer,
  row: {
    tenantId: string;
    userId: string;
    substituteId: string;
    fromDate: string;
    toDate: string | null;
    reason: string | null;
  },
) {
  const [inserted] = await (tx as typeof db)
    .insert(substitutionRules)
    .values({
      tenantId: row.tenantId,
      userId: row.userId,
      substituteId: row.substituteId,
      fromDate: row.fromDate,
      toDate: row.toDate,
      reason: row.reason,
    })
    .returning();
  return inserted;
}

export async function listSubstitutions(tenantId: string, limit = 200) {
  return scopedRead((tx) => tx
    .select()
    .from(substitutionRules)
    .where(and(eq(substitutionRules.tenantId, tenantId), eq(substitutionRules.active, true)))
    .limit(limit));
}

export async function deactivateSubstitution(
  tx: Writer,
  id: string,
  tenantId: string,
) {
  const [updated] = await (tx as typeof db)
    .update(substitutionRules)
    .set({ active: false })
    .where(and(eq(substitutionRules.id, id), eq(substitutionRules.tenantId, tenantId)))
    .returning();
  return updated ?? null;
}

/**
 * Find an active substitution for a user on a given date.
 * Returns the substitute_id if from_date <= today AND (to_date IS NULL OR to_date >= today).
 */
export async function findActiveSubstitute(
  tx: Writer,
  tenantId: string,
  userId: string,
  today: string,
): Promise<string | null> {
  const rows = await (tx as typeof db)
    .select({ substituteId: substitutionRules.substituteId })
    .from(substitutionRules)
    .where(
      and(
        eq(substitutionRules.tenantId, tenantId),
        eq(substitutionRules.userId, userId),
        eq(substitutionRules.active, true),
        lte(substitutionRules.fromDate, today),
        or(isNull(substitutionRules.toDate), gte(substitutionRules.toDate, today)),
      ),
    )
    .limit(1);

  return rows[0]?.substituteId ?? null;
}

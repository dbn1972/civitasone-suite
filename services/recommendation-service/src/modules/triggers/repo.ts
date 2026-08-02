/**
 * triggers/repo.ts — DB access for generic trigger rules.
 * Every query filters tenant_id explicitly in addition to RLS.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import { triggerRules, type TriggerRuleRow, type TriggerRuleInsert } from "./schema.js";
import type { TriggerRuleType } from "./schema.js";

export function toView(r: TriggerRuleRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    ruleType: r.ruleType,
    name: r.name,
    sourceCategory: r.sourceCategory,
    targetCategory: r.targetCategory,
    eventCode: r.eventCode,
    conditions: r.conditions,
    priority: r.priority,
    /** Basis points (10000 = 100%) — a ratio, so an integer JSON number. */
    weightBps: r.weightBps,
    active: r.active,
    effectiveFrom: r.effectiveFrom === null ? null : toIso(r.effectiveFrom),
    effectiveTo: r.effectiveTo === null ? null : toIso(r.effectiveTo),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export type TriggerRuleView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<TriggerRuleRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(triggerRules)
      .where(and(eq(triggerRules.id, id), eq(triggerRules.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  ruleType?: TriggerRuleType;
  targetCategory?: string;
  active?: boolean;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: TriggerRuleRow[]; total: number }> {
  const conditions: SQL[] = [eq(triggerRules.tenantId, tenantId)];
  if (filters.ruleType !== undefined) conditions.push(eq(triggerRules.ruleType, filters.ruleType));
  if (filters.targetCategory !== undefined) {
    conditions.push(eq(triggerRules.targetCategory, filters.targetCategory));
  }
  if (filters.active !== undefined) conditions.push(eq(triggerRules.active, filters.active));

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(triggerRules)
      .where(where)
      .orderBy(desc(triggerRules.priority), desc(triggerRules.weightBps), asc(triggerRules.id))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(triggerRules).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/**
 * Rules eligible for evaluation at `asOf`: active, and inside their half-open
 * [effectiveFrom, effectiveTo) window. The domain re-checks the window — SQL is
 * here to keep the candidate set small, not to be the authority on the rule.
 */
export async function listEvaluable(
  tenantId: string,
  asOf: Date,
  limit: number,
  ruleTypes?: readonly TriggerRuleType[],
): Promise<TriggerRuleRow[]> {
  const conditions: (SQL | undefined)[] = [
    eq(triggerRules.tenantId, tenantId),
    eq(triggerRules.active, true),
    or(isNull(triggerRules.effectiveFrom), lte(triggerRules.effectiveFrom, asOf)),
    or(isNull(triggerRules.effectiveTo), gt(triggerRules.effectiveTo, asOf)),
  ];

  if (ruleTypes !== undefined && ruleTypes.length > 0) {
    conditions.push(inArray(triggerRules.ruleType, [...ruleTypes]));
  }

  return scopedRead((tx) =>
    tx
      .select()
      .from(triggerRules)
      .where(and(...conditions))
      .orderBy(desc(triggerRules.priority), desc(triggerRules.weightBps), asc(triggerRules.id))
      .limit(limit),
  );
}

/** Same-name collision guard: one rule name per tenant keeps operator config legible. */
export async function findByName(tenantId: string, name: string): Promise<TriggerRuleRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(triggerRules)
      .where(and(eq(triggerRules.tenantId, tenantId), eq(triggerRules.name, name)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insert(tx: ScopedTx, row: TriggerRuleInsert): Promise<void> {
  await tx.insert(triggerRules).values(row);
}

/** Optimistic-locked update. Returns false on version mismatch or wrong tenant. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<TriggerRuleInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(triggerRules)
    .set({ ...patch, updatedAt: new Date(), version: sql`${triggerRules.version} + 1` })
    .where(
      and(
        eq(triggerRules.id, id),
        eq(triggerRules.tenantId, tenantId),
        eq(triggerRules.version, currentVersion),
      ),
    )
    .returning({ id: triggerRules.id });
  return result.length > 0;
}

/**
 * Deactivate rather than delete. A rule that raised a recommendation must stay
 * readable, otherwise the attribution records pointing at it lose their meaning.
 */
export async function deactivate(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const result = await tx
    .update(triggerRules)
    .set({ active: false, updatedAt: new Date(), updatedBy: actorId, version: sql`${triggerRules.version} + 1` })
    .where(and(eq(triggerRules.id, id), eq(triggerRules.tenantId, tenantId)))
    .returning({ id: triggerRules.id });
  return result.length > 0;
}

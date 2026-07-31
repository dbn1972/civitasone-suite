/**
 * guardrails/repo.ts — Database operations for tenant guardrail rules.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { guardrailRules, type GuardrailRuleRow, type GuardrailRuleInsert } from "./schema.js";

export function toView(r: GuardrailRuleRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    ruleType: r.ruleType,
    pattern: r.pattern,
    config: r.config,
    severity: r.severity,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type GuardrailRuleView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<GuardrailRuleRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(guardrailRules)
      .where(and(eq(guardrailRules.id, id), eq(guardrailRules.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string;
  ruleType?: string;
  severity?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: GuardrailRuleRow[]; total: number }> {
  const conditions: SQL[] = [eq(guardrailRules.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(guardrailRules.status, filters.status));
  if (filters.ruleType) conditions.push(eq(guardrailRules.ruleType, filters.ruleType));
  if (filters.severity) conditions.push(eq(guardrailRules.severity, filters.severity));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(guardrailRules)
      .where(where)
      .orderBy(desc(guardrailRules.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(guardrailRules).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/** Active rules for a tenant — the working set evaluated on every prompt. */
export async function listActive(tenantId: string, ids?: string[]): Promise<GuardrailRuleRow[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(guardrailRules)
      .where(and(eq(guardrailRules.tenantId, tenantId), eq(guardrailRules.status, "active")))
      .orderBy(desc(guardrailRules.updatedAt)),
  );
  if (!ids || ids.length === 0) return rows;
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.id));
}

export async function insert(tx: ScopedTx, row: GuardrailRuleInsert): Promise<void> {
  await tx.insert(guardrailRules).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<GuardrailRuleInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(guardrailRules)
    .set({ ...patch, updatedAt: new Date(), version: sql`${guardrailRules.version} + 1` })
    .where(and(
      eq(guardrailRules.id, id),
      eq(guardrailRules.tenantId, tenantId),
      eq(guardrailRules.version, currentVersion),
    ))
    .returning({ id: guardrailRules.id });
  return result.length > 0;
}

/** Soft delete — a deleted rule is disabled so historical audits stay explainable. */
export async function softDelete(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  actorId: string,
): Promise<boolean> {
  const result = await tx
    .update(guardrailRules)
    .set({
      status: "disabled",
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${guardrailRules.version} + 1`,
    })
    .where(and(
      eq(guardrailRules.id, id),
      eq(guardrailRules.tenantId, tenantId),
      eq(guardrailRules.version, currentVersion),
    ))
    .returning({ id: guardrailRules.id });
  return result.length > 0;
}

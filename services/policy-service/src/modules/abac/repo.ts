import { eq, and } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import { abacRules, type AbacRuleRow, type AbacRuleInsert } from "./schema.js";
import { parseExpression, type CompiledRule, type RuleExpression } from "./domain.js";

export interface RuleView {
  id: string;
  tenantId: string;
  roleId: string;
  expression: RuleExpression;
  enabled: boolean;
  version: number;
}

function toRuleView(r: AbacRuleRow): RuleView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    roleId: r.roleId,
    expression: parseExpression(r.expression),
    enabled: r.enabled,
    version: r.version,
  };
}

function toCompiled(r: AbacRuleRow): CompiledRule {
  return { id: r.id, roleId: r.roleId, enabled: r.enabled, expression: parseExpression(r.expression) };
}

// ── reads (tenant-scoped) ─────────────────────────────────────────────
export async function findRuleById(tenantId: string, id: string): Promise<RuleView | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(abacRules)
    .where(and(eq(abacRules.tenantId, tenantId), eq(abacRules.id, id))).limit(1));
  return rows[0] ? toRuleView(rows[0]) : null;
}

export async function findRulesByTenant(tenantId: string, limit = 500): Promise<RuleView[]> {
  return (await readScoped(tenantId, (tx) => tx.select().from(abacRules)
    .where(eq(abacRules.tenantId, tenantId)).limit(limit))).map(toRuleView);
}

// Compiled, enabled rules for a tenant — the input to the evaluation engine.
export async function loadCompiledRules(tenantId: string, limit = 1000): Promise<CompiledRule[]> {
  return (await readScoped(tenantId, (tx) => tx.select().from(abacRules)
    .where(and(eq(abacRules.tenantId, tenantId), eq(abacRules.enabled, true))).limit(limit)))
    .map(toCompiled);
}

// ── writes (tenant-scoped) ────────────────────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insertRule(tx: Writer, row: AbacRuleInsert): Promise<void> {
  await tx.insert(abacRules).values(row);
}

export async function updateRule(
  tx: Writer,
  tenantId: string,
  id: string,
  patch: Partial<AbacRuleInsert>,
): Promise<void> {
  await tx.update(abacRules).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(abacRules.tenantId, tenantId), eq(abacRules.id, id)));
}

export async function deleteRule(tx: Writer, tenantId: string, id: string): Promise<void> {
  await tx.delete(abacRules).where(and(eq(abacRules.tenantId, tenantId), eq(abacRules.id, id)));
}

export async function findRuleByIdTx(tx: Writer, tenantId: string, id: string): Promise<AbacRuleRow | null> {
  const rows = await tx.select().from(abacRules)
    .where(and(eq(abacRules.tenantId, tenantId), eq(abacRules.id, id))).limit(1);
  return rows[0] ?? null;
}

/**
 * CR-MKT-06 / F.5 — inbox extension reads and writes.
 */
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import {
  keywordRules,
  inboundAutoResponses,
  conversationHandoffs,
  handoffAudit,
  type KeywordRuleInsert,
  type KeywordRuleRow,
  type InboundAutoResponseInsert,
  type ConversationHandoffRow,
  type HandoffAuditInsert,
  type HandoffAuditRow,
} from "./keyword-schema.js";
import type { KeywordRule, MatchType } from "./keyword-domain.js";
import { INITIAL_HANDOFF_STATE, type HandoffState } from "./handoff-domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertKeywordRule(tx: Writer, row: KeywordRuleInsert): Promise<void> {
  await tx.insert(keywordRules).values(row);
}

export async function updateKeywordRule(
  tx: Writer, tenantId: string, id: string,
  set: Partial<Pick<KeywordRuleInsert, "keyword" | "matchType" | "channel" | "priority" | "responseBody" | "action" | "enabled">>,
  actorId: string,
): Promise<boolean> {
  const rows = await tx.select({ version: keywordRules.version }).from(keywordRules)
    .where(and(eq(keywordRules.tenantId, tenantId), eq(keywordRules.id, id))).limit(1);
  const current = rows[0];
  if (!current) return false;
  await tx.update(keywordRules).set({
    ...set, updatedAt: new Date(), updatedBy: actorId, version: current.version + 1,
  }).where(and(eq(keywordRules.tenantId, tenantId), eq(keywordRules.id, id)));
  return true;
}

function toDomainRule(row: KeywordRuleRow): KeywordRule {
  return {
    id: row.id,
    keyword: row.keyword,
    matchType: row.matchType as MatchType,
    priority: row.priority,
    channel: row.channel,
    enabled: row.enabled,
    responseBody: row.responseBody,
    action: row.action,
  };
}

/** Enabled rules for the tenant, as the domain matcher expects them. */
export async function findEnabledRulesInTx(
  tx: Writer, tenantId: string,
): Promise<KeywordRule[]> {
  const rows = await tx.select().from(keywordRules)
    .where(and(eq(keywordRules.tenantId, tenantId), eq(keywordRules.enabled, true)));
  return rows.map(toDomainRule);
}

export async function findEnabledRules(tenantId: string): Promise<KeywordRule[]> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(keywordRules)
    .where(and(eq(keywordRules.tenantId, tenantId), eq(keywordRules.enabled, true))));
  return rows.map(toDomainRule);
}

export async function listKeywordRules(
  tenantId: string, limit: number, offset: number,
): Promise<{ rows: KeywordRuleRow[]; total: number }> {
  return readScoped(tenantId, async (tx) => {
    const rows = await tx.select().from(keywordRules)
      .where(eq(keywordRules.tenantId, tenantId))
      .orderBy(asc(keywordRules.priority), asc(keywordRules.keyword))
      .limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` })
      .from(keywordRules).where(eq(keywordRules.tenantId, tenantId));
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function findKeywordRuleById(
  tenantId: string, id: string,
): Promise<KeywordRuleRow | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(keywordRules)
    .where(and(eq(keywordRules.tenantId, tenantId), eq(keywordRules.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function insertAutoResponse(tx: Writer, row: InboundAutoResponseInsert): Promise<void> {
  await tx.insert(inboundAutoResponses).values(row);
}

/* ---------------------------------------------------------------- handoff */

export async function findHandoffInTx(
  tx: Writer, tenantId: string, conversationId: string,
): Promise<ConversationHandoffRow | null> {
  const rows = await tx.select().from(conversationHandoffs)
    .where(and(
      eq(conversationHandoffs.tenantId, tenantId),
      eq(conversationHandoffs.conversationId, conversationId),
    )).limit(1);
  return rows[0] ?? null;
}

export async function findHandoff(
  tenantId: string, conversationId: string,
): Promise<ConversationHandoffRow | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(conversationHandoffs)
    .where(and(
      eq(conversationHandoffs.tenantId, tenantId),
      eq(conversationHandoffs.conversationId, conversationId),
    )).limit(1));
  return rows[0] ?? null;
}

/**
 * A conversation with no handoff row has never been handed off, so it is by
 * definition still AI-handled. Callers get a state, never null.
 */
export async function currentHandoffState(
  tenantId: string, conversationId: string,
): Promise<{ state: HandoffState; assignedAgentId: string | null; exists: boolean }> {
  const row = await findHandoff(tenantId, conversationId);
  if (!row) return { state: INITIAL_HANDOFF_STATE, assignedAgentId: null, exists: false };
  return { state: row.state as HandoffState, assignedAgentId: row.assignedAgentId, exists: true };
}

export async function upsertHandoff(
  tx: Writer,
  row: { id: string; tenantId: string; conversationId: string; state: HandoffState; assignedAgentId: string | null; actorId: string },
): Promise<void> {
  await tx.insert(conversationHandoffs).values({
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    state: row.state,
    assignedAgentId: row.assignedAgentId,
    createdBy: row.actorId,
    updatedBy: row.actorId,
    version: 1,
  }).onConflictDoUpdate({
    target: [conversationHandoffs.tenantId, conversationHandoffs.conversationId],
    set: {
      state: row.state,
      assignedAgentId: row.assignedAgentId,
      updatedAt: new Date(),
      updatedBy: row.actorId,
      version: sql`${conversationHandoffs.version} + 1`,
    },
  });
}

export async function insertHandoffAudit(tx: Writer, row: HandoffAuditInsert): Promise<void> {
  await tx.insert(handoffAudit).values(row);
}

export async function listHandoffAudit(
  tenantId: string, conversationId: string, limit: number,
): Promise<HandoffAuditRow[]> {
  return readScoped(tenantId, (tx) => tx.select().from(handoffAudit)
    .where(and(
      eq(handoffAudit.tenantId, tenantId),
      eq(handoffAudit.conversationId, conversationId),
    ))
    .orderBy(desc(handoffAudit.occurredAt))
    .limit(limit));
}

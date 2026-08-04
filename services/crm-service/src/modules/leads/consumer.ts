/**
 * Lead scoring consumer.
 *
 * Listens for contact attribute change events and recomputes the lead score
 * within 5 seconds. The score is persisted on the contacts row (score column).
 *
 * Validates: Requirements 8.5 — recalculate within 5s of attribute change
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import * as scoreRulesRepo from "./score-rules-repo.js";
import { idempotentId } from "@civitasone/auth";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { computeLeadScore } from "./scoring.js";
import type { ScoringRule, LeadAttributes } from "./scoring.js";

/** Internal command topic for score recalculation */
export const LEAD_SCORE_RECALC = "crm.lead.score_recalculate";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "contact";

/**
 * Default scoring rules — tenant-configurable in production.
 * This serves as the fallback when no tenant-specific rules are configured.
 */
export const DEFAULT_SCORING_RULES: ScoringRule[] = [
  {
    attribute: "leadSource",
    weight: 30,
    scoreFn: (value: unknown): number => {
      const sourceScores: Record<string, number> = {
        referral: 90,
        website: 70,
        campaign: 60,
        event: 50,
        cold_call: 30,
        social: 40,
      };
      return sourceScores[String(value ?? "").toLowerCase()] ?? 20;
    },
  },
  {
    attribute: "company",
    weight: 25,
    scoreFn: (value: unknown): number => {
      // Has a company associated = higher engagement signal
      return value ? 70 : 20;
    },
  },
  {
    attribute: "lastActivityAt",
    weight: 25,
    scoreFn: (value: unknown): number => {
      if (!value) return 10;
      const ms = Date.now() - new Date(String(value)).getTime();
      const days = ms / (1000 * 60 * 60 * 24);
      if (days <= 7) return 100;
      if (days <= 14) return 80;
      if (days <= 30) return 60;
      if (days <= 60) return 40;
      return 20;
    },
  },
  {
    attribute: "email",
    weight: 20,
    scoreFn: (value: unknown): number => {
      // Having email = contactable = higher score
      return value ? 80 : 10;
    },
  },
];

/**
 * Retrieves the tenant's configured scoring rules (LQ-002). Falls back to and
 * lazy-seeds the code defaults when the tenant has configured none — see
 * score-rules-repo.getScoringRules. DEFAULT_SCORING_RULES is retained as the
 * canonical in-code fallback and for tests; DEFAULT_SCORE_RULE_CONFIGS is its
 * serializable twin that actually gets seeded.
 */
export async function getTenantScoringRules(tenantId: string, actorId: string): Promise<ScoringRule[]> {
  const rules = await scoreRulesRepo.getScoringRules(tenantId, actorId);
  return rules.length > 0 ? rules : DEFAULT_SCORING_RULES;
}

/** Per-attribute partial scores (0-100) for score-history explainability. */
function computeFactors(attributes: LeadAttributes, rules: ScoringRule[]): Record<string, number> {
  const factors: Record<string, number> = {};
  for (const r of rules) {
    const raw = r.scoreFn(attributes[r.attribute]);
    factors[r.attribute] = Math.max(0, Math.min(100, Math.round(raw)));
  }
  return factors;
}

/**
 * Registers lead scoring consumers on the queue.
 * Subscribes to:
 * - LEAD_SCORE_RECALC — explicit recalculation command
 * - crm.contact.updated — triggers automatic recalculation on attribute change
 */
export function registerLeadScoringConsumers(queue: Queue): void {
  // Explicit score recalculation command
  queue.subscribe(LEAD_SCORE_RECALC, async (msg: CommandEnvelope) => {
    const p = msg.payload as { contactId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await recalculateScore(tx, p.contactId, p.tenantId, msg);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.contactId));
  });

  // Automatic recalculation on contact attribute change
  queue.subscribe(EVENTS.contactUpdated, async (msg: CommandEnvelope) => {
    const p = msg.payload as { contactId: string; mergedFrom?: string };
    if (!p.contactId) return;
    // Derive a NAMESPACED but valid-uuid dedupe key: _inbox.processed.message_id is
    // uuid-typed, so the previous `score:<uuid>` string threw invalid-uuid and this
    // whole recalc-on-attribute-change path silently never persisted. Namespacing
    // (vs reusing msg.messageId) keeps a co-consumer of contact.updated from marking
    // this id first and starving the score recalc.
    const scoreMessageId = idempotentId({ idempotencyKey: `score:${msg.messageId}` });
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, scoreMessageId))) return;
      await recalculateScore(tx, p.contactId, msg.tenantId, msg);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.contactId));
  });
}

/**
 * Recalculates and persists the lead score for a given contact.
 *
 * All reads/writes go through the drizzle transaction handle `tx` (not the raw
 * pooled sqlClient): crm.contacts is FORCE RLS and only the transaction carries the
 * app.tenant_id GUC the policy checks, so a raw-client read would fail closed and
 * silently no-op. Every (re)score also appends a crm.lead_score_history row (LQ-002).
 */
async function recalculateScore(
  tx: unknown,
  contactId: string,
  tenantId: string,
  msg: CommandEnvelope,
): Promise<void> {
  const dtx = tx as typeof db;
  // Fetch current contact attributes + the previous score for the history delta.
  const rows = (await dtx.execute(sql`
    SELECT lead_source, company, last_activity_at, email, phone, lead_status, city, designation, score
    FROM crm.contacts
    WHERE id = ${contactId} AND tenant_id = ${tenantId} AND status = 'active'
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (rows.length === 0) return;

  const row = rows[0]!;
  const leadAttributes: LeadAttributes = {
    leadSource: row.lead_source,
    company: row.company,
    lastActivityAt: row.last_activity_at,
    email: row.email,
    phone: row.phone,
    leadStatus: row.lead_status,
    city: row.city,
    designation: row.designation,
  };

  const rules = await getTenantScoringRules(tenantId, msg.actorId);
  const score = computeLeadScore(leadAttributes, rules);
  const factors = computeFactors(leadAttributes, rules);
  const previousScore = row.score == null ? null : Number(row.score);

  // Persist score
  await dtx.execute(sql`
    UPDATE crm.contacts
    SET score = ${score}, updated_at = now()
    WHERE id = ${contactId} AND tenant_id = ${tenantId}
  `);

  // LQ-002: append the score history row (rule-based path).
  await scoreRulesRepo.insertScoreHistory(dtx, {
    tenantId,
    leadId: contactId,
    score,
    previousScore,
    factors,
    source: "rule",
    reason: "attribute_change",
  });

  // Emit audit event for score change
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "crm",
      action: "score_recalculated",
      resourceType: "contact",
      resourceId: contactId,
      outcome: "success",
      score,
    },
  });
}

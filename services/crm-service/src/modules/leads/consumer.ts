/**
 * Lead scoring consumer.
 *
 * Listens for contact attribute change events and recomputes the lead score
 * within 5 seconds. The score is persisted on the contacts row (score column).
 *
 * Validates: Requirements 8.5 — recalculate within 5s of attribute change
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db, sqlClient } from "../../shared/db.js";
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
 * Retrieves scoring rules for a tenant. Currently returns defaults;
 * in production this would load tenant-configured rules from the DB.
 */
export function getTenantScoringRules(_tenantId: string): ScoringRule[] {
  return DEFAULT_SCORING_RULES;
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
    // Use a derived messageId to ensure idempotency for score recalc
    const scoreMessageId = `score:${msg.messageId}`;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, scoreMessageId))) return;
      await recalculateScore(tx, p.contactId, msg.tenantId, msg);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.contactId));
  });
}

/**
 * Recalculates and persists the lead score for a given contact.
 */
async function recalculateScore(
  tx: unknown,
  contactId: string,
  tenantId: string,
  msg: CommandEnvelope,
): Promise<void> {
  // Fetch current contact attributes
  const rows = await sqlClient`
    SELECT lead_source, company, last_activity_at, email, phone, lead_status, city, designation
    FROM crm.contacts
    WHERE id = ${contactId} AND tenant_id = ${tenantId} AND status = 'active'
    LIMIT 1
  `;

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

  const rules = getTenantScoringRules(tenantId);
  const score = computeLeadScore(leadAttributes, rules);

  // Persist score
  await sqlClient`
    UPDATE crm.contacts
    SET score = ${score}, updated_at = now()
    WHERE id = ${contactId} AND tenant_id = ${tenantId}
  `;

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

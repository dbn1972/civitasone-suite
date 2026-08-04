/**
 * Consumers for lead assignment & escalation (AS-001..004).
 *
 * All writers here follow the service invariant: one tenant-scoped transaction,
 * `markProcessed` for idempotent redelivery, audit/event via the outbox so the
 * trail commits with the row. `autoAssign` is exported so the inbound-capture
 * consumer can route a freshly captured lead in its own transaction.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { assignLead } from "../leads/assignment.js";
import * as repo from "./repo.js";

const log = pino({ name: "crm-assignment-consumer" });
const AUDIT = "audit.event.record";
const RESOURCE = "assignment_rule";

export interface AssignCtx {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

/**
 * Route a lead through the tenant's assignment rules and persist the outcome.
 * Returns the assigned ownerId, or null when nothing was applied (no rules, or
 * no eligible owner). MUST run inside a tenant-scoped transaction — it reads the
 * assignment rules, availability snapshot and the lead facts through RLS.
 */
export async function autoAssign(
  tx: repo.Tx,
  ctx: AssignCtx,
  leadId: string,
  method: "auto" | "manual" = "auto",
): Promise<string | null> {
  const ruleViews = await repo.listRulesTx(tx, ctx.tenantId);
  if (ruleViews.length === 0) return null; // nothing configured ⇒ leave as captured

  const facts = await repo.leadFacts(tx, ctx.tenantId, leadId);
  if (!facts) return null;

  const agents = await repo.agentAvailability(tx, ctx.tenantId);
  const engineRules = ruleViews.map(repo.toEngineRule);

  // Fallback: the first rule that declares one, else the lead's current owner.
  const declaredFallback = ruleViews.find((r) => r.fallbackOwnerId)?.fallbackOwnerId ?? null;
  const fallback = declaredFallback ?? facts.ownerId ?? "";

  const result = assignLead(
    { id: facts.id, territory: facts.territory, score: facts.score, product: facts.product, segment: facts.segment, language: facts.language },
    engineRules,
    fallback,
    { agents },
  );

  if (!result.assignedTo) return null; // no rule matched and no fallback

  await repo.applyOwner(tx, ctx.tenantId, leadId, result.assignedTo, ctx.actorId);
  await repo.insertAssignmentLog(tx, {
    tenantId: ctx.tenantId,
    leadId,
    ownerId: result.assignedTo,
    ruleId: result.matchedRuleId,
    method,
    assignedBy: ctx.actorId,
  });
  if (result.matchedRuleId && result.roundRobinIndex !== undefined) {
    await repo.persistRoundRobinCursor(tx, ctx.tenantId, result.matchedRuleId, result.roundRobinIndex);
  }

  await enqueue(tx as never, {
    topic: EVENTS.leadAssigned,
    eventType: EVENTS.leadAssigned,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: { leadId, ownerId: result.assignedTo, ruleId: result.matchedRuleId, method, reason: result.reason },
  });
  await enqueue(tx as never, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: "crm",
      action: "lead_assigned",
      resourceType: "contact",
      resourceId: leadId,
      outcome: "success",
      metadata: { ownerId: result.assignedTo, ruleId: result.matchedRuleId, method, reason: result.reason },
    },
  });
  return result.assignedTo;
}

function jsonb(v: unknown): string {
  return JSON.stringify(v ?? {});
}

export function registerAssignmentConsumers(queue: Queue): void {
  // ── Assignment rule CRUD ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.createAssignmentRule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; ruleType: string;
      criteria?: unknown; ordinal?: number; enabled?: boolean; fallbackOwnerId?: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.assignment_rules
            (id, tenant_id, name, type, criteria, ordinal, enabled, fallback_owner_id, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.ruleType}, ${jsonb(p.criteria)}::jsonb,
                  ${p.ordinal ?? 0}, ${p.enabled ?? true}, ${p.fallbackOwnerId ?? null},
                  ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (id) DO NOTHING
        `);
        await auditEvent(tx, msg, EVENTS.assignmentRuleCreated, "assignment_rule_create", RESOURCE, p.id);
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createAssignmentRule failed"); throw err; }
  });

  queue.subscribe(COMMANDS.updateAssignmentRule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name?: string; ruleType?: string;
      criteria?: unknown; ordinal?: number; enabled?: boolean; fallbackOwnerId?: string | null;
    };
    try {
      const setFallback = p.fallbackOwnerId !== undefined;
      const fallbackVal = p.fallbackOwnerId ?? null;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          UPDATE crm.assignment_rules SET
            name = COALESCE(${p.name ?? null}, name),
            type = COALESCE(${p.ruleType ?? null}, type),
            criteria = COALESCE(${p.criteria === undefined ? null : jsonb(p.criteria)}::jsonb, criteria),
            ordinal = COALESCE(${p.ordinal ?? null}, ordinal),
            enabled = COALESCE(${p.enabled ?? null}, enabled),
            fallback_owner_id = CASE WHEN ${setFallback} THEN ${fallbackVal}::uuid ELSE fallback_owner_id END,
            updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await auditEvent(tx, msg, EVENTS.assignmentRuleUpdated, "assignment_rule_update", RESOURCE, p.id);
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) { log.error({ err, messageId: msg.messageId }, "updateAssignmentRule failed"); throw err; }
  });

  queue.subscribe(COMMANDS.deleteAssignmentRule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`DELETE FROM crm.assignment_rules WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await auditEvent(tx, msg, EVENTS.assignmentRuleDeleted, "assignment_rule_delete", RESOURCE, p.id);
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) { log.error({ err, messageId: msg.messageId }, "deleteAssignmentRule failed"); throw err; }
  });

  // ── Manual assign / accept ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assignLeadManual, async (msg) => {
    const p = msg.payload as { leadId: string; tenantId: string; ownerId?: string; runRules?: boolean };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ctx = { tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
        if (p.ownerId) {
          await repo.applyOwner(tx, p.tenantId, p.leadId, p.ownerId, msg.actorId);
          await repo.insertAssignmentLog(tx, {
            tenantId: p.tenantId, leadId: p.leadId, ownerId: p.ownerId,
            ruleId: null, method: "manual", assignedBy: msg.actorId,
          });
          await enqueue(tx, {
            topic: EVENTS.leadAssigned, eventType: EVENTS.leadAssigned, tenantId: p.tenantId,
            actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { leadId: p.leadId, ownerId: p.ownerId, ruleId: null, method: "manual", reason: "manual_pick" },
          });
          await enqueue(tx, {
            topic: AUDIT, eventType: AUDIT, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { service: "crm", action: "lead_assigned", resourceType: "contact", resourceId: p.leadId, outcome: "success", metadata: { ownerId: p.ownerId, method: "manual" } },
          });
        } else if (p.runRules) {
          await autoAssign(tx, ctx, p.leadId, "auto");
        }
      });
      await cache.invalidateResource(p.tenantId, "contact");
    } catch (err) { log.error({ err, messageId: msg.messageId }, "assignLeadManual failed"); throw err; }
  });

  queue.subscribe(COMMANDS.acceptLead, async (msg) => {
    const p = msg.payload as { leadId: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const n = await repo.markAccepted(tx, p.tenantId, p.leadId);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "lead_accepted", resourceType: "contact", resourceId: p.leadId, outcome: n > 0 ? "success" : "rejected_not_found" },
        });
        if (n > 0) {
          await enqueue(tx, {
            topic: EVENTS.leadAccepted, eventType: EVENTS.leadAccepted, tenantId: p.tenantId,
            actorId: msg.actorId, correlationId: msg.correlationId, payload: { leadId: p.leadId },
          });
        }
      });
      await cache.invalidateResource(p.tenantId, "contact");
    } catch (err) { log.error({ err, messageId: msg.messageId }, "acceptLead failed"); throw err; }
  });

  // ── Assignment targets (AS-002) ────────────────────────────────────────────
  registerTargetConsumers(queue);

  // ── Escalation rules (AS-004) ──────────────────────────────────────────────
  queue.subscribe(COMMANDS.upsertEscalationRule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; trigger: string; thresholdMinutes: number;
      recipientRole?: string; recipientId?: string; reassign?: boolean; reassignOwnerId?: string; enabled?: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.escalation_rules
            (id, tenant_id, name, trigger, threshold_minutes, recipient_role, recipient_id, reassign, reassign_owner_id, enabled, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.trigger}, ${p.thresholdMinutes},
                  ${p.recipientRole ?? null}, ${p.recipientId ?? null}, ${p.reassign ?? false},
                  ${p.reassignOwnerId ?? null}, ${p.enabled ?? true}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, trigger = EXCLUDED.trigger, threshold_minutes = EXCLUDED.threshold_minutes,
            recipient_role = EXCLUDED.recipient_role, recipient_id = EXCLUDED.recipient_id,
            reassign = EXCLUDED.reassign, reassign_owner_id = EXCLUDED.reassign_owner_id,
            enabled = EXCLUDED.enabled, updated_at = now(), updated_by = ${msg.actorId},
            version = crm.escalation_rules.version + 1
        `);
        await auditEvent(tx, msg, EVENTS.escalationRuleUpserted, "escalation_rule_upsert", "escalation_rule", p.id);
      });
      await cache.invalidateResource(p.tenantId, "escalation_rule");
    } catch (err) { log.error({ err, messageId: msg.messageId }, "upsertEscalationRule failed"); throw err; }
  });

  queue.subscribe(COMMANDS.deleteEscalationRule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`DELETE FROM crm.escalation_rules WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await auditEvent(tx, msg, EVENTS.escalationRuleDeleted, "escalation_rule_delete", "escalation_rule", p.id);
      });
      await cache.invalidateResource(p.tenantId, "escalation_rule");
    } catch (err) { log.error({ err, messageId: msg.messageId }, "deleteEscalationRule failed"); throw err; }
  });
}

function registerTargetConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createAssignmentQueue, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; teamId?: string; description?: string; enabled?: boolean };
    await simpleInsert(msg, () => sql`
      INSERT INTO crm.assignment_queues (id, tenant_id, name, team_id, description, enabled, created_by)
      VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.teamId ?? null}, ${p.description ?? null}, ${p.enabled ?? true}, ${msg.actorId})
      ON CONFLICT (id) DO NOTHING`, "assignment_queue", p.id, "assignment_queue_create");
  });
  queue.subscribe(COMMANDS.deleteAssignmentQueue, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await simpleInsert(msg, () => sql`DELETE FROM crm.assignment_queues WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`, "assignment_queue", p.id, "assignment_queue_delete");
  });

  queue.subscribe(COMMANDS.createTerritory, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; code: string; region?: string; ownerId?: string };
    await simpleInsert(msg, () => sql`
      INSERT INTO crm.territories (id, tenant_id, name, code, region, owner_id, created_by)
      VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.code}, ${p.region ?? null}, ${p.ownerId ?? null}, ${msg.actorId})
      ON CONFLICT (id) DO NOTHING`, "territory", p.id, "territory_create");
  });
  queue.subscribe(COMMANDS.deleteTerritory, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await simpleInsert(msg, () => sql`DELETE FROM crm.territories WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`, "territory", p.id, "territory_delete");
  });

  queue.subscribe(COMMANDS.createPartner, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; partnerType?: string; ownerId?: string };
    await simpleInsert(msg, () => sql`
      INSERT INTO crm.partners (id, tenant_id, name, partner_type, owner_id, created_by)
      VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.partnerType ?? null}, ${p.ownerId ?? null}, ${msg.actorId})
      ON CONFLICT (id) DO NOTHING`, "partner", p.id, "partner_create");
  });
  queue.subscribe(COMMANDS.deletePartner, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await simpleInsert(msg, () => sql`DELETE FROM crm.partners WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`, "partner", p.id, "partner_delete");
  });

  queue.subscribe(COMMANDS.createBranch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; code?: string; territoryId?: string };
    await simpleInsert(msg, () => sql`
      INSERT INTO crm.branches (id, tenant_id, name, code, territory_id, created_by)
      VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.code ?? null}, ${p.territoryId ?? null}, ${msg.actorId})
      ON CONFLICT (id) DO NOTHING`, "branch", p.id, "branch_create");
  });
  queue.subscribe(COMMANDS.deleteBranch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await simpleInsert(msg, () => sql`DELETE FROM crm.branches WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`, "branch", p.id, "branch_delete");
  });
}

/** Shared write+audit path for the AS-002 config tables. */
async function simpleInsert(
  msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
  stmt: () => ReturnType<typeof sql>,
  resourceType: string,
  resourceId: string,
  action: string,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(stmt());
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "crm", action, resourceType, resourceId, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, resourceType);
  } catch (err) { log.error({ err, messageId: msg.messageId, action }, "assignment target write failed"); throw err; }
}

async function auditEvent(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx as never, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { resourceId },
  });
  await enqueue(tx as never, {
    topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType, resourceId, outcome: "success" },
  });
}

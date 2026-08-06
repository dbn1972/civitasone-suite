/**
 * G22 — Context-attach consumers.
 *
 * Handles:
 * 1. CRUD commands for rules (create, update, delete)
 * 2. Inbound event processing — matches events against rules and creates attachments
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { matchRule, extractMatchValue } from "./domain.js";
import { invalidateRules, invalidateAttachments } from "./queries.js";
import type { ContextAttachRule } from "./domain.js";

const log = pino({ name: "crm-context-attach-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE_RULE = "context_attach_rule";
const RESOURCE_ATTACHMENT = "context_attachment";

interface CreateRulePayload {
  name: string;
  eventType: string;
  matchField: string;
  matchTarget: string;
  targetField: string;
  action: string;
  active: boolean;
  priority: number;
}

interface UpdateRulePayload {
  id: string;
  changed: Record<string, unknown>;
  version: number;
}

interface DeleteRulePayload {
  id: string;
}

interface InboundEventPayload {
  eventRef: string;
  eventType: string;
  data: Record<string, unknown>;
}

export function registerContextAttachConsumers(queue: Queue): void {
  // ── Rule CRUD ──

  queue.subscribe<CreateRulePayload>(COMMANDS.createContextAttachRule, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const id = randomUUID();
        await tx.execute(sql`
          INSERT INTO crm.context_attach_rules
            (id, tenant_id, name, event_type, match_field, match_target, target_field, action, active, priority, created_by, updated_by)
          VALUES (
            ${id}, ${msg.tenantId}, ${p.name}, ${p.eventType}, ${p.matchField},
            ${p.matchTarget}, ${p.targetField}, ${p.action}, ${p.active}, ${p.priority},
            ${msg.actorId}, ${msg.actorId}
          )
        `);
        await enqueue(tx, {
          topic: EVENTS.contextAttachRuleCreated,
          eventType: EVENTS.contextAttachRuleCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { ruleId: id, name: p.name, eventType: p.eventType, matchTarget: p.matchTarget, action: p.action },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "crm", action: "create", resourceType: RESOURCE_RULE, resourceId: id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createContextAttachRule failed");
      throw err;
    }
    await invalidateRules(msg.tenantId);
  });

  queue.subscribe<UpdateRulePayload>(COMMANDS.updateContextAttachRule, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const setClauses: string[] = [];
        for (const [key, val] of Object.entries(p.changed)) {
          const col = camelToSnake(key);
          setClauses.push(`${col} = '${String(val)}'`);
        }
        if (setClauses.length === 0) return;

        const rows = (await tx.execute(sql`
          UPDATE crm.context_attach_rules
          SET ${sql.raw(setClauses.join(", "))},
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${msg.tenantId} AND version = ${p.version}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;

        if (rows.length === 0) return;

        await enqueue(tx, {
          topic: EVENTS.contextAttachRuleUpdated,
          eventType: EVENTS.contextAttachRuleUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { ruleId: p.id, changed: Object.keys(p.changed) },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "crm", action: "update", resourceType: RESOURCE_RULE, resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateContextAttachRule failed");
      throw err;
    }
    await invalidateRules(msg.tenantId);
  });

  queue.subscribe<DeleteRulePayload>(COMMANDS.deleteContextAttachRule, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = (await tx.execute(sql`
          DELETE FROM crm.context_attach_rules
          WHERE id = ${p.id} AND tenant_id = ${msg.tenantId}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await enqueue(tx, {
          topic: EVENTS.contextAttachRuleDeleted,
          eventType: EVENTS.contextAttachRuleDeleted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { ruleId: p.id },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "crm", action: "delete", resourceType: RESOURCE_RULE, resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteContextAttachRule failed");
      throw err;
    }
    await invalidateRules(msg.tenantId);
  });

  // ── Inbound event processing ──

  queue.subscribe<InboundEventPayload>(COMMANDS.processContextAttachEvent, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Load active rules for this tenant and event type
        const rules = (await tx.execute(sql`
          SELECT id, tenant_id AS "tenantId", event_type AS "eventType", match_field AS "matchField",
                 match_target AS "matchTarget", target_field AS "targetField", action, active, priority
          FROM crm.context_attach_rules
          WHERE tenant_id = ${msg.tenantId} AND active = true AND event_type = ${p.eventType}
          ORDER BY priority ASC
        `)) as unknown as ContextAttachRule[];

        const rule = matchRule({ eventType: p.eventType, payload: p.data }, rules);
        if (!rule) return;

        const matchValue = extractMatchValue({ eventType: p.eventType, payload: p.data }, rule.matchField);
        if (!matchValue) return;

        // Resolve the CRM entity by looking up matchValue against targetField on the target table
        const targetTable = resolveTargetTable(rule.matchTarget);
        if (!targetTable) return;

        const targets = (await tx.execute(sql`
          SELECT id FROM ${sql.raw(targetTable)}
          WHERE tenant_id = ${msg.tenantId} AND ${sql.raw(camelToSnake(rule.targetField))} = ${matchValue}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;

        if (targets.length === 0) return;

        const targetId = targets[0]!.id;
        const attachmentId = randomUUID();

        // Idempotent insert — ON CONFLICT on (tenant_id, rule_id, event_ref)
        await tx.execute(sql`
          INSERT INTO crm.context_attachments
            (id, tenant_id, rule_id, event_ref, target_type, target_id, metadata)
          VALUES (
            ${attachmentId}, ${msg.tenantId}, ${rule.id}, ${p.eventRef},
            ${rule.matchTarget}, ${targetId}, ${JSON.stringify(p.data)}::jsonb
          )
          ON CONFLICT (tenant_id, rule_id, event_ref) DO NOTHING
        `);

        await enqueue(tx, {
          topic: EVENTS.contextAttached,
          eventType: EVENTS.contextAttached,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            attachmentId,
            ruleId: rule.id,
            eventRef: p.eventRef,
            targetType: rule.matchTarget,
            targetId,
            action: rule.action,
          },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "crm", action: "attach", resourceType: RESOURCE_ATTACHMENT, resourceId: attachmentId, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "processContextAttachEvent failed");
      throw err;
    }
    await invalidateAttachments(msg.tenantId);
  });
}

function resolveTargetTable(matchTarget: string): string | null {
  switch (matchTarget) {
    case "account": return "crm.accounts";
    case "contact": return "crm.contacts";
    case "deal": return "crm.deals";
    case "case": return "crm.onboarding_cases";
    default: return null;
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

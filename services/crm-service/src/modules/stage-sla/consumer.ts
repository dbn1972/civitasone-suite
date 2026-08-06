/**
 * G3 — Stage SLA policy consumer.
 * Handles create / update / delete commands. Emits outbox events + audit trail.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-stage-sla-consumer" });
const RESOURCE = "stage_sla_policy";
const CACHE_PREFIX = "crm:stage-sla-policies";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerStageSLAConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createStageSLAPolicy, async (msg) => {
    const p = msg.payload as {
      tenantId: string; stageCode: string; slaHours: number;
      warnAtPercent: number; breachAction: string; notifyRoles: string[];
      escalationTargetId: string | null; active: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const rows = (await tx.execute(sql`
          INSERT INTO crm.stage_sla_policies
            (tenant_id, stage_code, sla_hours, warn_at_percent, breach_action,
             notify_roles, escalation_target_id, active, created_by, updated_by)
          VALUES (${p.tenantId}, ${p.stageCode}, ${p.slaHours}, ${p.warnAtPercent},
                  ${p.breachAction}, ${JSON.stringify(p.notifyRoles)}::jsonb,
                  ${p.escalationTargetId ?? null}, ${p.active}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, stage_code) DO UPDATE
            SET sla_hours = EXCLUDED.sla_hours,
                warn_at_percent = EXCLUDED.warn_at_percent,
                breach_action = EXCLUDED.breach_action,
                notify_roles = EXCLUDED.notify_roles,
                escalation_target_id = EXCLUDED.escalation_target_id,
                active = EXCLUDED.active,
                updated_by = EXCLUDED.updated_by,
                updated_at = now(),
                version = crm.stage_sla_policies.version + 1
          RETURNING id
        `)) as unknown as Array<{ id: string }>;

        const resourceId = rows[0]?.id ?? msg.messageId;

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageSLAPolicyCreated,
          action: "create",
          resourceType: RESOURCE,
          resourceId,
          payload: { stageCode: p.stageCode, slaHours: p.slaHours, breachAction: p.breachAction, active: p.active },
        });
      });
      await cache.invalidate(`${CACHE_PREFIX}:${msg.tenantId}`);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createStageSLAPolicy failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateStageSLAPolicy, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; slaHours?: number; warnAtPercent?: number;
      breachAction?: string; notifyRoles?: string[];
      escalationTargetId?: string | null; active?: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        await tx.execute(sql`
          UPDATE crm.stage_sla_policies
          SET sla_hours = COALESCE(${p.slaHours ?? null}::int, sla_hours),
              warn_at_percent = COALESCE(${p.warnAtPercent ?? null}::int, warn_at_percent),
              breach_action = COALESCE(${p.breachAction ?? null}::varchar, breach_action),
              notify_roles = COALESCE(${p.notifyRoles ? JSON.stringify(p.notifyRoles) : null}::jsonb, notify_roles),
              escalation_target_id = CASE WHEN ${p.escalationTargetId !== undefined} THEN ${p.escalationTargetId ?? null}::uuid ELSE escalation_target_id END,
              active = COALESCE(${p.active ?? null}::boolean, active),
              updated_by = ${msg.actorId},
              updated_at = now(),
              version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageSLAPolicyUpdated,
          action: "update",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { id: p.id, slaHours: p.slaHours, breachAction: p.breachAction, active: p.active },
        });
      });
      await cache.invalidate(`${CACHE_PREFIX}:${msg.tenantId}`);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateStageSLAPolicy failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteStageSLAPolicy, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Soft-delete: set active = false
        await tx.execute(sql`
          UPDATE crm.stage_sla_policies
          SET active = false, updated_by = ${msg.actorId}, updated_at = now(), version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageSLAPolicyDeleted,
          action: "delete",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { id: p.id },
        });
      });
      await cache.invalidate(`${CACHE_PREFIX}:${msg.tenantId}`);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteStageSLAPolicy failed");
      throw err;
    }
  });
}

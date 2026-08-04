/**
 * Consumer for configurable lead field rules (LM-001).
 *
 * Idempotency has two layers: `markProcessed` gates redelivery, and the write is an
 * upsert on (tenant_id, field_name). Either alone would cover the common case;
 * together a replay cannot produce two contradicting rules for one field even if the
 * inbox row is lost.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./field-rules-repo.js";

const log = pino({ name: "crm-lead-field-rules-consumer" });
const RESOURCE = "lead_field_rule";

export interface UpsertLeadFieldRulePayload {
  id: string;
  tenantId: string;
  fieldName: string;
  required: boolean;
  weight: number;
  enabled: boolean;
  createdBy: string;
  updatedBy: string;
}

export interface DeleteLeadFieldRulePayload {
  tenantId: string;
  fieldName: string;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

export function registerLeadFieldRuleConsumers(queue: Queue): void {
  queue.subscribe<UpsertLeadFieldRulePayload>(COMMANDS.upsertLeadFieldRule, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsert(tx, {
          id: p.id,
          tenantId: p.tenantId,
          fieldName: p.fieldName,
          required: p.required,
          weight: p.weight,
          enabled: p.enabled,
          createdBy: p.createdBy,
          updatedBy: p.updatedBy,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadFieldRuleUpserted,
          action: "upsert",
          resourceType: RESOURCE,
          resourceId: p.fieldName,
          payload: {
            fieldName: p.fieldName,
            required: p.required,
            weight: p.weight,
            enabled: p.enabled,
          },
        });
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "upsertLeadFieldRule failed");
      throw err;
    }
  });

  queue.subscribe<DeleteLeadFieldRulePayload>(COMMANDS.deleteLeadFieldRule, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.remove(tx, p.tenantId, p.fieldName);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadFieldRuleDeleted,
          action: "delete",
          resourceType: RESOURCE,
          resourceId: p.fieldName,
          payload: { fieldName: p.fieldName },
        });
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteLeadFieldRule failed");
      throw err;
    }
  });
}

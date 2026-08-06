import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const RESOURCE = "segment_eligibility_rule";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerSegmentEligibilityConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createSegmentEligibilityRule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; segmentCode: string; productId: string;
      eligible: boolean; channelOverride: string[] | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx as any, {
        id: p.id,
        tenantId: p.tenantId,
        segmentCode: p.segmentCode,
        productId: p.productId,
        eligible: p.eligible,
        channelOverride: p.channelOverride,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.segmentEligibilityRuleCreated, {
        ruleId: p.id, segmentCode: p.segmentCode, productId: p.productId, eligible: p.eligible,
      }, "create", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.updateSegmentEligibilityRule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; eligible?: boolean;
      channelOverride?: string[] | null; version: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const fields: { eligible?: boolean; channelOverride?: string[] | null } = {};
      if (p.eligible !== undefined) fields.eligible = p.eligible;
      if (p.channelOverride !== undefined) fields.channelOverride = p.channelOverride;
      const updated = await repo.updateWithVersion(tx as any, p.id, p.tenantId, fields, p.version, msg.actorId);
      if (!updated) {
        await emitAudit(tx, msg, "update", p.id, "version_conflict");
        return;
      }
      await emit(tx, msg, EVENTS.segmentEligibilityRuleUpdated, {
        ruleId: p.id, fields,
      }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.deleteSegmentEligibilityRule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.softDelete(tx as any, p.id, p.tenantId);
      if (!deleted) {
        await emitAudit(tx, msg, "delete", p.id, "not_found");
        return;
      }
      await emit(tx, msg, EVENTS.segmentEligibilityRuleDeleted, { ruleId: p.id }, "delete", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "segment_eligibility_rule", resourceId, outcome: "success" },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "segment_eligibility_rule", resourceId, outcome },
  });
}

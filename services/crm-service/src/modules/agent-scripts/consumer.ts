import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { canPublish, canDeprecate } from "./domain.js";
import type { AgentScriptView } from "./schema.js";

const RESOURCE = "agent_script";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerAgentScriptConsumers(queue: Queue): void {
  queue.subscribe<AgentScriptView>(COMMANDS.createAgentScript, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        productCode: p.productCode,
        language: p.language,
        scriptKey: p.scriptKey,
        title: p.title,
        body: p.body,
        versionNumber: p.versionNumber,
        status: p.status,
        tags: p.tags,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.agentScriptCreated, { scriptId: p.id, productCode: p.productCode, language: p.language }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.updateAgentScript, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; title?: string; body?: string; tags?: string[]; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const fields: repo.AgentScriptPatch = {};
      if (p.title !== undefined) fields.title = p.title;
      if (p.body !== undefined) fields.body = p.body;
      if (p.tags !== undefined) fields.tags = p.tags;
      const updated = await repo.updateScript(tx, p.id, p.tenantId, fields, p.version, msg.actorId);
      if (!updated) {
        await emitAudit(tx, msg, "update", p.id, "version_conflict");
        return;
      }
      await emit(tx, msg, EVENTS.agentScriptUpdated, { scriptId: p.id }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.publishAgentScript, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findByIdRaw(tx, p.id, p.tenantId);
      if (!row) {
        await emitAudit(tx, msg, "publish", p.id, "not_found");
        return;
      }
      if (!canPublish(row)) {
        await emitAudit(tx, msg, "publish", p.id, "invalid_status_transition");
        return;
      }
      await repo.setStatus(tx, p.id, p.tenantId, "published", msg.actorId);
      await emit(tx, msg, EVENTS.agentScriptPublished, { scriptId: p.id, productCode: row.productCode, language: row.language }, "publish", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.deprecateAgentScript, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findByIdRaw(tx, p.id, p.tenantId);
      if (!row) {
        await emitAudit(tx, msg, "deprecate", p.id, "not_found");
        return;
      }
      if (!canDeprecate(row)) {
        await emitAudit(tx, msg, "deprecate", p.id, "invalid_status_transition");
        return;
      }
      await repo.setStatus(tx, p.id, p.tenantId, "deprecated", msg.actorId);
      await emit(tx, msg, EVENTS.agentScriptDeprecated, { scriptId: p.id }, "deprecate", p.id);
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
    payload: { service: "crm", action, resourceType: "agent_script", resourceId, outcome: "success" },
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
    payload: { service: "crm", action, resourceType: "agent_script", resourceId, outcome },
  });
}

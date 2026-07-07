import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { PipelineView, PipelineStage } from "./schema.js";

const RESOURCE = "pipeline";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerPipelineConsumers(queue: Queue): void {
  queue.subscribe<PipelineView>(COMMANDS.createPipeline, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        stages: p.stages,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.pipelineCreated, { pipelineId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.updatePipeline, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name?: string;
      stages?: PipelineStage[]; version: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.updateWithVersion(
        tx, p.id, p.tenantId, p.version,
        { ...(p.name !== undefined ? { name: p.name } : {}), ...(p.stages !== undefined ? { stages: p.stages } : {}) },
        msg.actorId,
      );
      if (!updated) {
        // Version conflict — emit audit and skip.
        await emitAudit(tx, msg, "update", p.id, "version_conflict");
        return;
      }
      await emit(tx, msg, EVENTS.pipelineUpdated, { pipelineId: p.id }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.deletePipeline, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.softDelete(tx, p.id, p.tenantId, msg.actorId);
      await emit(tx, msg, EVENTS.pipelineDeleted, { pipelineId: p.id }, "delete", p.id);
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
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "pipeline", resourceId, outcome: "success" },
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
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "pipeline", resourceId, outcome },
  });
}

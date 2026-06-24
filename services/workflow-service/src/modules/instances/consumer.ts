import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { computeDueAt } from "../../shared/sla.js";
import { normalizeContext } from "../../shared/condition.js";
import { COMMANDS, EVENTS, INSTANCE_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as taskRepo from "../tasks/repo.js";
import * as defRepo from "../definitions/repo.js";
import * as historyRepo from "../history/repo.js";
import type { CreateInstancePayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

type ExtendedCreatePayload = CreateInstancePayload & { startNodeKey?: string };

export function registerInstancesConsumers(queue: Queue): void {
  queue.subscribe<ExtendedCreatePayload>(COMMANDS.createInstance, async (msg) => {
    let taskId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const context = normalizeContext(p.context);
      const def = p.definitionCode
        ? await defRepo.findByCodeTx(tx, p.tenantId, p.definitionCode)
        : null;

      let startNode = def ? await defRepo.findFirstNodeTx(tx, def.id) : null;
      if (def && p.startNodeKey) {
        startNode = await defRepo.findNodeByKeyTx(tx, def.id, p.startNodeKey) ?? startNode;
      }

      const dueAt = computeDueAt(startNode?.slaMinutes);

      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        status: p.status,
        definitionId: def?.id ?? null,
        // version pinning: in-flight instances are unaffected by later edits
        definitionVersion: def?.version ?? null,
        refType: p.refType ?? null,
        refId: p.refId ?? null,
        currentNode: startNode?.nodeKey ?? null,
        context,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      taskId = randomUUID();
      await taskRepo.insert(tx, {
        id: taskId,
        tenantId: p.tenantId,
        instanceId: p.id,
        name: startNode?.name ?? p.initialTaskName,
        status: "pending",
        roleRef: startNode?.roleRef ?? null,
        nodeKey: startNode?.nodeKey ?? null,
        refType: p.refType ?? null,
        refId: p.refId ?? null,
        dueAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await historyRepo.record(tx, {
        tenantId: p.tenantId,
        instanceId: p.id,
        taskId,
        fromNode: null,
        toNode: startNode?.nodeKey ?? null,
        action: "create",
        decision: null,
        actorId: msg.actorId,
        detail: { name: p.name, definitionVersion: def?.version ?? null },
      });

      await emit(tx, msg, EVENTS.instanceCreated, { instanceId: p.id, name: p.name, taskId, refType: p.refType, refId: p.refId }, "create", p.id);
      await emit(tx, msg, EVENTS.taskAssigned, {
        taskId,
        instanceId: p.id,
        name: startNode?.name ?? p.initialTaskName,
        roleRef: startNode?.roleRef,
        refType: p.refType,
        refId: p.refId,
      }, "assign_task", taskId);
    });
    const view = {
      id: msg.payload.id,
      tenantId: msg.payload.tenantId,
      name: msg.payload.name,
      status: msg.payload.status,
      version: msg.payload.version,
    };
    await cache.put(cache.makeKey(msg.tenantId, INSTANCE_RESOURCE, msg.payload.id), view);
    await cache.invalidateResource(msg.tenantId, INSTANCE_RESOURCE);
    if (taskId) await cache.invalidateResource(msg.tenantId, "task");
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "instance", resourceId, outcome: "success" } });
}

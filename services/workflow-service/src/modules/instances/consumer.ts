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
import { subscribeWithDlq } from "../dlq/wrap.js";
import { resolveAssignee } from "../assignment/resolver.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

type ExtendedCreatePayload = CreateInstancePayload & { startNodeKey?: string };

export function registerInstancesConsumers(queue: Queue): void {
  // RLS (#146): run every handler inside the message's tenant context so
  // db.transaction() sets the app.tenant_id GUC (workflow_svc is NOBYPASSRLS).
  queue = tenantScoped(queue);
  subscribeWithDlq<ExtendedCreatePayload>(queue, COMMANDS.createInstance, async (msg) => {
    let taskId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const context = normalizeContext(p.context);
      const def = p.definitionCode
        ? await defRepo.findByCodeTx(tx, p.tenantId, p.definitionCode)
        : null;

      // R13: a definition code was requested but no seeded definition resolves
      // for this tenant. Proceeding would create a single ad-hoc task whose lone
      // approval rubber-stamps the entire decision (SO→US→DS chain bypassed).
      // Fail closed: persist a `rejected` instance, record it, emit a rejection,
      // and create NO actionable approval task. The source module's file simply
      // never gets an approval rather than a one-click rubber-stamp.
      if (p.definitionCode && !def) {
        await repo.insert(tx, {
          id: p.id, tenantId: p.tenantId, name: p.name, status: "rejected",
          definitionId: null, definitionVersion: null,
          refType: p.refType ?? null, refId: p.refId ?? null,
          currentNode: null, context,
          createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await historyRepo.record(tx, {
          tenantId: p.tenantId, instanceId: p.id, taskId: null,
          fromNode: null, toNode: null, action: "rejected", decision: null,
          actorId: msg.actorId,
          detail: { reason: "unknown_definition", definitionCode: p.definitionCode },
        });
        await emit(tx, msg, EVENTS.instanceRejected, {
          instanceId: p.id, reason: "unknown_definition",
          definitionCode: p.definitionCode, refType: p.refType, refId: p.refId,
        }, "reject_unknown_definition", p.id);
        return; // no task created → no rubber-stamp path
      }

      let startNode = def ? await defRepo.findFirstNodeTx(tx, def.id) : null;
      if (def && p.startNodeKey) {
        startNode = await defRepo.findNodeByKeyTx(tx, def.id, p.startNodeKey) ?? startNode;
      }

      const dueAt = computeDueAt(startNode?.slaMinutes);
      // Gap 4 — auto-assign the start task when the start node declares a
      // strategy (round-robin / least-loaded / hierarchy). null => unassigned.
      const startAssignee = (startNode?.assignStrategy && startNode.assignStrategy !== "none")
        ? await resolveAssignee(tx, p.tenantId, startNode.roleRef ?? null, startNode.assignStrategy, startNode.assignRef ?? null)
        : null;

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
        ...(startAssignee ? { assigneeId: startAssignee } : {}),
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

  // P0-2 — lifecycle transitions. Each applies the status change under the
  // instance row lock, appends an immutable transition_history row, and emits an
  // event + audit record. Guarded against terminal/illegal transitions so a
  // replayed or stale command cannot revive a cancelled/completed instance.
  registerLifecycle(queue, COMMANDS.cancelInstance, "cancel", EVENTS.instanceCancelled, ["active", "suspended"]);
  registerLifecycle(queue, COMMANDS.suspendInstance, "suspend", EVENTS.instanceSuspended, ["active"]);
  registerLifecycle(queue, COMMANDS.resumeInstance, "resume", EVENTS.instanceResumed, ["suspended"]);
}

type LifecycleMsgPayload = {
  id: string;
  tenantId: string;
  fromStatus: string;
  toStatus: string;
  reason?: string;
};

function registerLifecycle(
  queue: Queue,
  command: string,
  action: string,
  eventType: string,
  allowedFrom: string[],
): void {
  subscribeWithDlq<LifecycleMsgPayload>(queue, command, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // Lock the row and re-check the transition is still legal (the synchronous
      // pre-check in commands.ts is advisory; this is authoritative).
      const instance = await repo.lockByIdTx(tx, p.id);
      if (!instance || instance.tenantId !== p.tenantId) return;
      if (!allowedFrom.includes(instance.status)) return; // already moved on / illegal
      await repo.markStatus(tx, p.id, p.toStatus, msg.actorId);
      await historyRepo.record(tx, {
        tenantId: p.tenantId,
        instanceId: p.id,
        taskId: null,
        fromNode: instance.currentNode ?? null,
        toNode: instance.currentNode ?? null,
        action,
        decision: null,
        actorId: msg.actorId,
        detail: {
          fromStatus: instance.status,
          toStatus: p.toStatus,
          ...(p.reason !== undefined ? { reason: p.reason } : {}),
        },
      });
      await emit(tx, msg, eventType, { instanceId: p.id, fromStatus: instance.status, toStatus: p.toStatus }, action, p.id);
    });
    await cache.invalidateResource(msg.tenantId, INSTANCE_RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "instance", resourceId, outcome: "success" } });
}

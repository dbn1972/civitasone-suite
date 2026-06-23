import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, DISPATCH, TASK_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as instanceRepo from "../instances/repo.js";
import * as defRepo from "../definitions/repo.js";
import type { TaskView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

type CompletePayload = TaskView & { decision?: string };

export function registerTasksConsumers(queue: Queue): void {
  queue.subscribe<CompletePayload>(COMMANDS.completeTask, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const decision = p.decision ?? "approve";
      const updated = await repo.markCompleted(tx, p.id, p.tenantId, msg.actorId, decision);
      if (!updated) return;

      const instance = await instanceRepo.findByIdTx(tx, p.instanceId);

      if (decision === "reject" && instance) {
        await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
        if (instance.refType === "estab_file" && instance.refId) {
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: DISPATCH.fileReject,
            eventType: DISPATCH.fileReject,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { fileId: instance.refId, tenantId: msg.tenantId, rejectedBy: msg.actorId },
          });
        }
      } else if (decision === "approve" && instance?.definitionId && instance.currentNode) {
        const nextNode = await defRepo.findNextNodeTx(tx, instance.definitionId, instance.currentNode);
        if (nextNode) {
          await instanceRepo.updateCurrentNode(tx, instance.id, nextNode.nodeKey, msg.actorId);
          const newTaskId = randomUUID();
          await repo.insert(tx, {
            id: newTaskId,
            tenantId: p.tenantId,
            instanceId: instance.id,
            name: nextNode.name,
            status: "pending",
            roleRef: nextNode.roleRef,
            refType: instance.refType,
            refId: instance.refId,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
          });
          await emit(tx, msg, EVENTS.taskAssigned, {
            taskId: newTaskId,
            instanceId: instance.id,
            name: nextNode.name,
            roleRef: nextNode.roleRef,
            refType: instance.refType,
            refId: instance.refId,
          }, "assign_task", newTaskId, {
            recipient: nextNode.roleRef ?? instance.id,
            variables: {
              taskId: newTaskId,
              instanceId: instance.id,
              summary: `Task assigned: ${nextNode.name}`,
              link: `/workflow/tasks/${newTaskId}`,
            },
          });
        } else if (instance.refType && instance.refId) {
          await dispatchDomainApprove(tx, msg, instance.refType, instance.refId);
          await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
        } else {
          await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
        }
      } else if (decision === "approve" && instance?.refType && instance.refId) {
        await dispatchDomainApprove(tx, msg, instance.refType, instance.refId);
        await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
      } else if (decision === "approve" && instance) {
        await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
      }

      await emit(tx, msg, EVENTS.taskCompleted, {
        taskId: p.id,
        instanceId: p.instanceId,
        decision,
        refType: instance?.refType,
        refId: instance?.refId,
      }, "complete", p.id, {
        recipient: p.roleRef ?? msg.actorId,
        variables: {
          taskId: p.id,
          instanceId: p.instanceId,
          decision,
          summary: `Task ${decision === "reject" ? "rejected" : "completed"}: ${p.name}`,
          link: `/workflow/tasks/${p.id}`,
        },
      });
    });
    await cache.put(cache.makeKey(msg.tenantId, TASK_RESOURCE, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, TASK_RESOURCE);
  });
}

async function dispatchDomainApprove(
  tx: unknown,
  msg: CommandEnvelope,
  refType: string,
  refId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  if (refType === "leave_app") {
    await enqueue(t, {
      topic: DISPATCH.leaveApprove,
      eventType: DISPATCH.leaveApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { id: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
    return;
  }
  if (refType === "payroll_run") {
    await enqueue(t, {
      topic: DISPATCH.payrollRunApprove,
      eventType: DISPATCH.payrollRunApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { id: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
    return;
  }
  if (refType === "procurement_indent") {
    await enqueue(t, {
      topic: DISPATCH.indentApprove,
      eventType: DISPATCH.indentApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { id: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
    return;
  }
  if (refType === "procurement_po") {
    await enqueue(t, {
      topic: DISPATCH.poApprove,
      eventType: DISPATCH.poApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { id: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
    return;
  }
  if (refType === "estab_file") {
    await enqueue(t, {
      topic: DISPATCH.fileApprove,
      eventType: DISPATCH.fileApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { fileId: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
    return;
  }
  if (refType === "asset_disposal") {
    await enqueue(t, {
      topic: DISPATCH.assetDisposeApprove,
      eventType: DISPATCH.assetDisposeApprove,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { pendingId: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
    });
  }
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string, notify?: { recipient: string; variables: Record<string, string> }): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  if (notify) {
    await enqueue(t, {
      topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: buildNotificationPayload({
        eventType,
        recipient: notify.recipient,
        variables: notify.variables,
      }),
    });
  }
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "task", resourceId, outcome: "success" } });
}

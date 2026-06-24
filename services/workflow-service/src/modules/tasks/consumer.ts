import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { computeDueAt } from "../../shared/sla.js";
import { normalizeContext } from "../../shared/condition.js";
import { COMMANDS, EVENTS, DISPATCH, TASK_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as instanceRepo from "../instances/repo.js";
import * as defRepo from "../definitions/repo.js";
import * as historyRepo from "../history/repo.js";
import type { TaskView } from "./schema.js";
import type { InstanceRow } from "../instances/schema.js";

const AUDIT_TOPIC = "audit.event.record";

// The transaction handle passed by drizzle's db.transaction() — needs select/insert/update.
type Tx = Parameters<typeof repo.insert>[0] & Parameters<typeof defRepo.findNodeByKeyTx>[0];

type CompletePayload = TaskView & { decision?: string; sodOverride?: boolean };

export function registerTasksConsumers(queue: Queue): void {
  queue.subscribe<CompletePayload>(COMMANDS.completeTask, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const decision = p.decision ?? "approve";
      const sodOverride = p.sodOverride ?? false;
      const updated = await repo.markCompleted(tx, p.id, p.tenantId, msg.actorId, decision, sodOverride);
      if (!updated) return;

      const instance = await instanceRepo.findByIdTx(tx, p.instanceId);

      // ---- audit: this task's transition (with SoD override flagged) ----
      await historyRepo.record(tx, {
        tenantId: p.tenantId,
        instanceId: p.instanceId,
        taskId: p.id,
        fromNode: p.nodeKey ?? instance?.currentNode ?? null,
        toNode: null,
        action: decision === "reject" ? "reject" : decision === "return" ? "return" : "complete",
        decision,
        actorId: msg.actorId,
        detail: sodOverride ? { sodOverride: true, overriddenBy: "super_admin" } : {},
      });

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
      } else if (decision === "return" && instance?.definitionId && p.nodeKey) {
        // ---- return / rework: send work back to the immediately prior node ----
        await handleReturn(tx, msg, instance, p);
      } else if (decision === "approve" && instance?.definitionId && instance.currentNode) {
        await handleAdvance(tx, msg, instance, p);
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
          summary: `Task ${decision === "reject" ? "rejected" : decision === "return" ? "returned" : "completed"}: ${p.name}`,
          link: `/workflow/tasks/${p.id}`,
        },
      });
    });
    await cache.put(cache.makeKey(msg.tenantId, TASK_RESOURCE, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, TASK_RESOURCE);
  });
}

/**
 * Edge-driven forward progression from the just-completed node. Resolves
 * successor node(s) from the edge table evaluated against the instance context,
 * then enters each successor (see enterNode):
 *  - 0 matching edges  -> terminal: dispatch domain approval / complete.
 *  - 1 matching edge    -> XOR/linear advance.
 *  - N matching edges    -> parallel split (every matching branch fires).
 */
async function handleAdvance(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  p: CompletePayload,
): Promise<void> {
  const fromNode = p.nodeKey ?? instance.currentNode!;
  const isBranch = (await defRepo.findEdgesFromTx(tx, instance.definitionId!, fromNode)).length > 1;
  await advanceFrom(tx, msg, instance, fromNode, isBranch ? "branch" : "advance");
}

/**
 * Resolve edges out of `fromNode` and enter each target. A target may be a
 * gateway (split/join) which is processed automatically rather than producing a
 * human task.
 */
async function advanceFrom(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  fromNode: string,
  action: string,
): Promise<void> {
  const context = normalizeContext(instance.context);
  const targets = await defRepo.resolveNextNodesTx(tx, instance.definitionId!, fromNode, context);

  if (targets.length === 0) {
    if (instance.refType && instance.refId) {
      await dispatchDomainApprove(tx, msg, instance.refType, instance.refId);
    }
    await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
    return;
  }

  const splitAction = targets.length > 1 ? "split" : action;
  for (const targetKey of targets) {
    await enterNode(tx, msg, instance, fromNode, targetKey, splitAction);
  }
}

/**
 * Enter a node. Gateways auto-process; task nodes create a human task.
 *  - split: record the split and immediately fan out to its successors.
 *  - join:  only proceed once all sibling branches have closed; the last
 *           branch to arrive auto-advances past the join.
 *  - task:  create a pending task at the node.
 */
async function enterNode(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  fromNode: string,
  nodeKey: string,
  action: string,
): Promise<void> {
  const node = await defRepo.findNodeByKeyTx(tx, instance.definitionId!, nodeKey);
  if (!node) return;

  if (node.nodeType === "split") {
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
      fromNode, toNode: nodeKey, action: "split", decision: null, actorId: msg.actorId, detail: {},
    });
    await instanceRepo.updateCurrentNode(tx, instance.id, nodeKey, msg.actorId);
    await advanceFrom(tx, msg, instance, nodeKey, "split"); // fan out
    return;
  }

  if (node.nodeType === "join") {
    // openElsewhere = pending tasks still open on this instance (sibling branches)
    const openElsewhere = await repo.countOpenTasks(tx, instance.id);
    if (openElsewhere > 0) {
      await historyRepo.record(tx, {
        tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
        fromNode, toNode: nodeKey, action: "join", decision: null, actorId: msg.actorId,
        detail: { waiting: true, openBranches: openElsewhere },
      });
      return; // last branch to close will pass the join
    }
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
      fromNode, toNode: nodeKey, action: "join", decision: null, actorId: msg.actorId,
      detail: { joined: true },
    });
    await instanceRepo.updateCurrentNode(tx, instance.id, nodeKey, msg.actorId);
    await advanceFrom(tx, msg, instance, nodeKey, "advance"); // proceed past join
    return;
  }

  await spawnTask(tx, msg, instance, fromNode, node, action);
}

async function spawnTask(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  fromNode: string,
  node: { nodeKey: string; name: string; roleRef: string | null; slaMinutes: number | null },
  action: string,
): Promise<void> {
  await instanceRepo.updateCurrentNode(tx, instance.id, node.nodeKey, msg.actorId);
  const newTaskId = randomUUID();
  const dueAt = computeDueAt(node.slaMinutes);
  await repo.insert(tx, {
    id: newTaskId,
    tenantId: instance.tenantId,
    instanceId: instance.id,
    name: node.name,
    status: "pending",
    roleRef: node.roleRef,
    nodeKey: node.nodeKey,
    refType: instance.refType,
    refId: instance.refId,
    dueAt,
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
    version: 1,
  });
  await historyRepo.record(tx, {
    tenantId: instance.tenantId, instanceId: instance.id, taskId: newTaskId,
    fromNode, toNode: node.nodeKey, action, decision: null, actorId: msg.actorId, detail: {},
  });
  await emit(tx, msg, EVENTS.taskAssigned, {
    taskId: newTaskId,
    instanceId: instance.id,
    name: node.name,
    roleRef: node.roleRef,
    refType: instance.refType,
    refId: instance.refId,
  }, "assign_task", newTaskId, {
    recipient: node.roleRef ?? instance.id,
    variables: {
      taskId: newTaskId,
      instanceId: instance.id,
      summary: `Task assigned: ${node.name}`,
      link: `/workflow/tasks/${newTaskId}`,
    },
  });
}

/** return/rework: spawn a fresh task at a prior node (edge target reached or first node). */
async function handleReturn(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  p: CompletePayload,
): Promise<void> {
  const fromNode = p.nodeKey ?? instance.currentNode!;
  // Prior node = a node that has an edge INTO the current node.
  const incoming = await defRepo.findEdgesToTx(tx, instance.definitionId!, fromNode);
  const priorKey = incoming[0]?.fromNode ?? (await defRepo.findFirstNodeTx(tx, instance.definitionId!))?.nodeKey;
  if (!priorKey) return;
  const node = await defRepo.findNodeByKeyTx(tx, instance.definitionId!, priorKey);
  if (!node) return;
  await spawnTask(tx, msg, instance, fromNode, node, "return");
}

async function dispatchDomainApprove(
  tx: unknown,
  msg: CommandEnvelope,
  refType: string,
  refId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  const map: Record<string, { topic: string; idKey: string }> = {
    leave_app: { topic: DISPATCH.leaveApprove, idKey: "id" },
    payroll_run: { topic: DISPATCH.payrollRunApprove, idKey: "id" },
    procurement_indent: { topic: DISPATCH.indentApprove, idKey: "id" },
    procurement_po: { topic: DISPATCH.poApprove, idKey: "id" },
    estab_file: { topic: DISPATCH.fileApprove, idKey: "fileId" },
    asset_disposal: { topic: DISPATCH.assetDisposeApprove, idKey: "pendingId" },
  };
  const cfg = map[refType];
  if (!cfg) return;
  await enqueue(t, {
    topic: cfg.topic,
    eventType: cfg.topic,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { [cfg.idKey]: refId, tenantId: msg.tenantId, approvedBy: msg.actorId },
  });
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

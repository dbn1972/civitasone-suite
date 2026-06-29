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
import { resolveAssignee } from "../assignment/resolver.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { SYSTEM_ACTOR_ID } from "./sweeper.js";
import type { TaskView } from "./schema.js";
import type { InstanceRow } from "../instances/schema.js";

const AUDIT_TOPIC = "audit.event.record";

// SECURITY C1 — maximum call-activity nesting depth (root instance = depth 0).
// A spawn that would push the child past this is rejected (fail the parent, no
// spawn) so a recursive/mutually-recursive call graph cannot fork-bomb.
const MAX_CALL_DEPTH = Math.max(1, Number(process.env.WORKFLOW_MAX_CALL_DEPTH ?? 10));

// The transaction handle passed by drizzle's db.transaction() — needs
// select/insert/update + execute (for the assignment resolver's atomic cursor).
type Tx = Parameters<typeof repo.insert>[0] & Parameters<typeof defRepo.findNodeByKeyTx>[0]
  & Parameters<typeof resolveAssignee>[0];

type CompletePayload = TaskView & { decision?: string; sodOverride?: boolean };

export function registerTasksConsumers(queue: Queue): void {
  // Gap 3 — wrap with the consumer-side DLQ policy: transient failures retry,
  // a poison message is dead-lettered after WORKFLOW_DLQ_MAX_ATTEMPTS attempts.
  subscribeWithDlq<CompletePayload>(queue, COMMANDS.completeTask, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const decision = p.decision ?? "approve";
      const sodOverride = p.sodOverride ?? false;

      // H1 — serialize all branch closes / advances on this instance: take the
      // instance row lock FIRST, before any SoD read, completion, or join count,
      // so concurrent sibling completions run strictly one at a time per
      // instance. The locked row is the authoritative instance state below.
      const instance = await instanceRepo.lockByIdTx(tx, p.instanceId);

      // P0-2 — authoritative lifecycle gate. A task can only be completed while
      // its instance is active. If the instance was suspended or cancelled (or
      // already completed) between the HTTP pre-check and now, drop the command
      // without completing or advancing. Resume re-activates and a fresh
      // completeTask command will then pass.
      if (instance && instance.status !== "active") {
        await historyRepo.record(tx, {
          tenantId: p.tenantId,
          instanceId: p.instanceId,
          taskId: p.id,
          fromNode: p.nodeKey ?? instance.currentNode ?? null,
          toNode: null,
          action: "blocked",
          decision,
          actorId: msg.actorId,
          detail: { reason: "instance_not_active", instanceStatus: instance.status },
        });
        return;
      }

      // C2 — DURABLE SoD enforcement (the HTTP-handler pre-check is racy because
      // completed_by is only written here). Now that we hold the instance lock
      // and read prior completions FOR UPDATE, two back-to-back completions by
      // the same actor serialize and the second observes the first's completed
      // row. On violation: record an audit row and DO NOT complete/advance.
      if (!sodOverride && instance) {
        const selfApproval = instance.createdBy === msg.actorId;
        const priorByActor = await repo.priorActorTasksTx(tx, p.instanceId, msg.actorId);
        if (selfApproval || priorByActor.length > 0) {
          await historyRepo.record(tx, {
            tenantId: p.tenantId,
            instanceId: p.instanceId,
            taskId: p.id,
            fromNode: p.nodeKey ?? instance.currentNode ?? null,
            toNode: null,
            action: "sod_violation",
            decision,
            actorId: msg.actorId,
            detail: selfApproval
              ? { sodViolation: "self_approval" }
              : { sodViolation: "repeat_actor" },
          });
          return; // do not mark complete, do not advance
        }
      }

      // H2 — optimistic-locked completion (no-op on already-completed task).
      const updated = await repo.markCompleted(tx, p.id, p.tenantId, msg.actorId, decision, sodOverride);
      if (!updated) return;

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
        await completeInstance(tx, msg, instance, "reject");
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
        await completeInstance(tx, msg, instance, "approve");
      } else if (decision === "approve" && instance) {
        await completeInstance(tx, msg, instance, "approve");
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

      // G2 — per-level green note. On each APPROVE of an estab_file task, signal
      // estab to auto-create a signed (green), hash-chained note for this level,
      // so the file accumulates the SO→US→DS noting chain as the workflow
      // progresses (not just one note greened at the terminal step).
      if (decision === "approve" && instance?.refType === "estab_file" && instance.refId) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: DISPATCH.fileLevelApproved,
          eventType: DISPATCH.fileLevelApproved,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            fileId: instance.refId,
            nodeKey: p.nodeKey ?? null,
            roleRef: p.roleRef ?? null,
            levelName: p.name ?? null,
          },
        });
      }
    });
    await cache.put(cache.makeKey(msg.tenantId, TASK_RESOURCE, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, TASK_RESOURCE);
  });
}

/**
 * Edge-driven forward progression from the just-completed node. Branch
 * semantics are decided by the SOURCE node's nodeType (see advanceFrom), NOT by
 * the number of matching edges:
 *  - xor/exclusive -> at most ONE successor (lowest sort_order matching edge).
 *  - split/parallel -> fan out to EVERY matching edge.
 *  - 0 matching edges -> terminal: dispatch domain approval / complete.
 */
async function handleAdvance(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  p: CompletePayload,
): Promise<void> {
  const fromNode = p.nodeKey ?? instance.currentNode!;
  const srcNode = await defRepo.findNodeByKeyTx(tx, instance.definitionId!, fromNode);
  const isParallel = srcNode?.nodeType === "split" || srcNode?.nodeType === "parallel";
  await advanceFrom(tx, msg, instance, fromNode, isParallel ? "branch" : "advance");
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
  const matched = await defRepo.resolveNextNodesTx(tx, instance.definitionId!, fromNode, context);

  // M1 — branch fan-out is governed by the SOURCE node type, not edge count.
  // A split/parallel node fans out to every matching edge; any other node type
  // (xor/exclusive/task/linear) is exclusive and advances to exactly ONE
  // successor — the matching edge with the lowest sort_order. Without this an
  // xor node with overlapping conditions (or an always-true default edge) would
  // wrongly spawn multiple branches.
  const srcNode = await defRepo.findNodeByKeyTx(tx, instance.definitionId!, fromNode);
  const isParallel = srcNode?.nodeType === "split" || srcNode?.nodeType === "parallel";
  const targets = isParallel ? matched : matched.slice(0, 1);

  if (targets.length === 0) {
    if (instance.refType && instance.refId) {
      await dispatchDomainApprove(tx, msg, instance.refType, instance.refId);
    }
    await completeInstance(tx, msg, instance, "approve");
    return;
  }

  const splitAction = isParallel && targets.length > 1 ? "split" : action;
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

  // An explicit `end` node is terminal: complete the instance (and dispatch any
  // domain approval) instead of spawning a human task at it. Without this an
  // end node with an incoming edge would strand the instance on a dead task.
  if (node.nodeType === "end") {
    await instanceRepo.updateCurrentNode(tx, instance.id, nodeKey, msg.actorId);
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
      fromNode, toNode: nodeKey, action: "end", decision: null, actorId: msg.actorId, detail: {},
    });
    if (instance.refType && instance.refId) {
      await dispatchDomainApprove(tx, msg, instance.refType, instance.refId);
    }
    await completeInstance(tx, msg, instance, "approve");
    return;
  }

  // Gap 1 — sub-workflow / call-activity. Spawn a CHILD instance of the node's
  // call_definition_code and hold the parent here (a non-human "call task" with
  // is_call=true + child_instance_id) until the child reaches a terminal state.
  if (node.nodeType === "call") {
    await spawnCallActivity(tx, msg, instance, fromNode, node);
    return;
  }

  await spawnTask(tx, msg, instance, fromNode, node, action);
}

/**
 * Gap 1 — enter a call node: create a child instance of the target definition
 * (must be active + structurally valid) with a mapped context, and a parent
 * "call task" that waits for the child. The parent's currentNode becomes the
 * call node; it cannot advance until the child completes (see resumeParent).
 */
async function spawnCallActivity(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  fromNode: string,
  node: {
    nodeKey: string; name: string; roleRef: string | null;
    callDefinitionCode?: string | null; callContextMap?: Record<string, string> | null;
  },
): Promise<void> {
  await instanceRepo.updateCurrentNode(tx, instance.id, node.nodeKey, msg.actorId);

  const childDefCode = node.callDefinitionCode ?? null;
  const childDef = childDefCode ? await defRepo.findExecutableByCodeTx(tx, instance.tenantId, childDefCode) : null;

  // Parent call task: a non-human wait task held at the call node.
  const callTaskId = randomUUID();

  if (!childDef) {
    // Misconfigured / inactive child definition: record + fail the parent
    // instance rather than strand it silently.
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
      fromNode, toNode: node.nodeKey, action: "call_error", decision: null, actorId: msg.actorId,
      detail: { reason: "child_definition_not_active", callDefinitionCode: childDefCode },
    });
    await completeInstance(tx, msg, instance, "reject");
    return;
  }

  // SECURITY C1 — fork-bomb guard. The child would sit one level deeper than
  // the parent; reject the spawn (fail the parent, audited) if that exceeds the
  // configured max depth, OR if any ANCESTOR instance (walking parent_instance_id
  // up the chain, tenant-scoped) is already running this same target definition
  // (an A->...->A cycle). Either way: do NOT spawn an unbounded child.
  const childDepth = (instance.callDepth ?? 0) + 1;
  let cycle = false;
  if (childDepth <= MAX_CALL_DEPTH) {
    let ancestorId: string | null = instance.parentInstanceId ?? null;
    // include the immediate parent itself in the walk (instance is about to host
    // the child, so instance is the nearest ancestor of childDef).
    let cursor: InstanceRow | null = instance;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.definitionId === childDef.id) { cycle = true; break; }
      ancestorId = cursor.parentInstanceId ?? null;
      cursor = ancestorId
        ? await instanceRepo.findByIdTx(tx, ancestorId)
        : null;
      // tenant-scope the walk: never cross a tenant boundary.
      if (cursor && cursor.tenantId !== instance.tenantId) cursor = null;
    }
  }
  if (childDepth > MAX_CALL_DEPTH || cycle) {
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.id, taskId: null,
      fromNode, toNode: node.nodeKey, action: "call_error", decision: null, actorId: msg.actorId,
      detail: cycle
        ? { reason: "call_cycle", callDefinitionCode: childDefCode, definitionId: childDef.id }
        : { reason: "call_depth_exceeded", callDepth: childDepth, maxCallDepth: MAX_CALL_DEPTH },
    });
    await completeInstance(tx, msg, instance, "reject");
    return;
  }

  // map parent context -> child context (NULL map => pass through unchanged).
  const parentCtx = normalizeContext(instance.context);
  let childCtx: Record<string, unknown> = parentCtx;
  if (node.callContextMap && typeof node.callContextMap === "object") {
    childCtx = {};
    for (const [parentPath, childKey] of Object.entries(node.callContextMap)) {
      childCtx[childKey] = parentPath.split(".").reduce<unknown>(
        (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
        parentCtx,
      );
    }
  }

  const childId = randomUUID();
  const childStart = await defRepo.findFirstNodeTx(tx, childDef.id);

  // create the parent call task FIRST so its id can be stored on the child.
  await repo.insert(tx, {
    id: callTaskId,
    tenantId: instance.tenantId,
    instanceId: instance.id,
    name: `Call: ${node.name}`,
    status: "pending",
    roleRef: null,
    nodeKey: node.nodeKey,
    refType: instance.refType,
    refId: instance.refId,
    isCall: true,
    childInstanceId: childId,
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
    version: 1,
  });

  // create the child instance, linked back to the parent + call task.
  await instanceRepo.insert(tx, {
    id: childId,
    tenantId: instance.tenantId,
    name: `${childDef.name} (child of ${instance.name})`,
    status: "active",
    definitionId: childDef.id,
    definitionVersion: childDef.version,
    refType: instance.refType ?? null,
    refId: instance.refId ?? null,
    currentNode: childStart?.nodeKey ?? null,
    context: childCtx,
    parentInstanceId: instance.id,
    parentTaskId: callTaskId,
    parentNodeKey: node.nodeKey,
    callDepth: childDepth,
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
    version: 1,
  });

  // spawn the child's first task so the child can make progress.
  if (childStart) {
    const childTaskId = randomUUID();
    await repo.insert(tx, {
      id: childTaskId,
      tenantId: instance.tenantId,
      instanceId: childId,
      name: childStart.name,
      status: "pending",
      roleRef: childStart.roleRef,
      nodeKey: childStart.nodeKey,
      refType: instance.refType,
      refId: instance.refId,
      dueAt: computeDueAt(childStart.slaMinutes),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
      version: 1,
    });
    await emit(tx, msg, EVENTS.taskAssigned, {
      taskId: childTaskId, instanceId: childId, name: childStart.name, roleRef: childStart.roleRef,
    }, "assign_task", childTaskId);
  }

  await historyRepo.record(tx, {
    tenantId: instance.tenantId, instanceId: instance.id, taskId: callTaskId,
    fromNode, toNode: node.nodeKey, action: "call", decision: null, actorId: msg.actorId,
    detail: { childInstanceId: childId, callDefinitionCode: childDefCode, childVersion: childDef.version },
  });
  await emit(tx, msg, EVENTS.instanceCreated, {
    instanceId: childId, name: `${childDef.name} (child)`, parentInstanceId: instance.id,
  }, "create", childId);
}

/**
 * Gap 1 — mark an instance terminal, and if it is a CHILD of a call node, RESUME
 * the parent by auto-completing the waiting call task (carrying the child's
 * outcome). For a non-child instance this is just markCompleted. Resuming the
 * parent reuses the normal completeTask path so the parent advances along the
 * call node's outgoing edge through the same engine (edge conditions etc.).
 */
async function completeInstance(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  outcome: "approve" | "reject",
): Promise<void> {
  await instanceRepo.markCompleted(tx, instance.id, msg.actorId);

  if (!instance.parentInstanceId || !instance.parentTaskId) return;

  // resume the parent: complete the waiting call task with the child outcome.
  // H1 - verify the linkage before completing/advancing the parent. The call
  // task must (a) exist in THIS child tenant (findByIdTx is tenant-scoped),
  // (b) be an actual call task (is_call), (c) point back at THIS exact child
  // (child_instance_id === instance.id), and (d) share the child tenant. A
  // mismatched / cross-tenant / non-call linkage is rejected so a child can
  // only ever resume its own linked parent call task.
  const callTask = await repo.findByIdTx(tx, instance.parentTaskId, instance.tenantId);
  if (!callTask || callTask.status !== "pending") return;
  if (callTask.isCall !== true
      || callTask.childInstanceId !== instance.id
      || callTask.tenantId !== instance.tenantId) {
    await historyRepo.record(tx, {
      tenantId: instance.tenantId, instanceId: instance.parentInstanceId, taskId: callTask.id,
      fromNode: instance.parentNodeKey ?? null, toNode: null, action: "call_error", decision: null,
      actorId: SYSTEM_ACTOR_ID,
      detail: {
        reason: "call_task_linkage_mismatch",
        childInstanceId: instance.id,
        callTaskChildInstanceId: callTask.childInstanceId,
        isCall: callTask.isCall,
      },
    });
    return; // do not complete the call task / advance the parent
  }

  // mark the call task completed in-band (it's a system wait task; no SoD).
  await repo.markCompleted(tx, callTask.id, callTask.tenantId, SYSTEM_ACTOR_ID, outcome, true);
  await historyRepo.record(tx, {
    tenantId: instance.tenantId, instanceId: instance.parentInstanceId, taskId: callTask.id,
    fromNode: instance.parentNodeKey ?? null, toNode: null, action: "call_return", decision: outcome,
    actorId: SYSTEM_ACTOR_ID,
    detail: { childInstanceId: instance.id, outcome },
  });

  // advance the parent past the call node, in the same transaction.
  const parent = await instanceRepo.lockByIdTx(tx, instance.parentInstanceId);
  if (!parent || parent.status !== "active") return;

  if (outcome === "reject") {
    // propagate failure: reject closes the parent (mirrors a human reject).
    await completeInstance(tx, msg, parent, "reject");
    return;
  }
  if (parent.definitionId && instance.parentNodeKey) {
    await advanceFrom(tx, { ...msg, actorId: SYSTEM_ACTOR_ID }, parent, instance.parentNodeKey, "advance");
  }
}

async function spawnTask(
  tx: Tx,
  msg: CommandEnvelope,
  instance: InstanceRow,
  fromNode: string,
  node: {
    nodeKey: string; name: string; roleRef: string | null; slaMinutes: number | null;
    nodeType?: string; timerMinutes?: number | null;
    assignStrategy?: string | null; assignRef?: string | null;
  },
  action: string,
): Promise<void> {
  await instanceRepo.updateCurrentNode(tx, instance.id, node.nodeKey, msg.actorId);
  const newTaskId = randomUUID();
  const dueAt = computeDueAt(node.slaMinutes);
  // P1-2 — a `timer` node spawns a pending task carrying fire_at = now +
  // timer_minutes (default 0 -> fire immediately on next tick). The timer
  // sweeper auto-completes it (deemed approval), reusing the normal advance
  // path along the timer's outgoing edge.
  const isTimer = node.nodeType === "timer";
  // Gap 4 — auto-assignment. If the node declares a strategy, resolve a specific
  // assignee (round-robin / least-loaded / hierarchy) among the role-holders.
  // null => leave unassigned (legacy role-pool; any role-holder may claim).
  const assigneeId = (!isTimer && node.assignStrategy && node.assignStrategy !== "none")
    ? await resolveAssignee(tx, instance.tenantId, node.roleRef ?? null, node.assignStrategy, node.assignRef ?? null)
    : null;
  // SECURITY C-1b — enforce a minimum dwell at task creation: a timer fires no
  // sooner than now + max(timer_minutes, 1) minutes, so fire_at can never be in
  // the past (no instant deemed-approval). validateGraph already rejects
  // timer_minutes < 1 at deploy; this is the runtime backstop.
  const fireAt = isTimer
    ? (computeDueAt(Math.max(node.timerMinutes ?? 1, 1)) ?? new Date(Date.now() + 60_000))
    : null;
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
    ...(fireAt ? { fireAt } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
    version: 1,
  });
  await historyRepo.record(tx, {
    tenantId: instance.tenantId, instanceId: instance.id, taskId: newTaskId,
    fromNode, toNode: node.nodeKey, action: isTimer ? "timer_wait" : action, decision: null, actorId: msg.actorId,
    detail: isTimer
      ? { timerMinutes: node.timerMinutes ?? null, fireAt: fireAt?.toISOString() ?? null }
      : (assigneeId ? { assignStrategy: node.assignStrategy, assignee: assigneeId } : {}),
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

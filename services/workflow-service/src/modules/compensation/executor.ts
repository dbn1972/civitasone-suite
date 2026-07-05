/**
 * Compensation executor — runs compensation handlers in reverse completion order
 * when an instance is cancelled or encounters a failure.
 *
 * Design:
 * - Each definition node can declare a compensation_handler_key pointing to another node
 * - When triggered, we walk instance.completed_nodes in REVERSE order
 * - For each completed node that has a compensation_handler_key, we execute the handler
 * - Compensation is best-effort: a failing handler is logged but doesn't block
 * - All compensation activity is recorded in transition_history
 */

import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as defRepo from "../definitions/repo.js";
import * as instanceRepo from "../instances/repo.js";
import * as historyRepo from "../history/repo.js";

const log = pino({ name: "workflow-compensation" });
const AUDIT_TOPIC = "audit.event.record";
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompensationResult {
  compensated: number;
  failed: number;
  skipped: number;
  details: Array<{
    nodeKey: string;
    handlerKey: string;
    status: "compensated" | "failed" | "skipped";
    error?: string;
  }>;
}

type Writer = Pick<typeof db, "insert" | "update" | "select" | "execute">;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute compensation for a cancelled/rejected instance. Walks completed_nodes
 * in reverse order, invoking declared compensation handlers for each step.
 */
export async function runCompensation(
  instanceId: string,
  tenantId: string,
  actorId: string,
): Promise<CompensationResult> {
  const result: CompensationResult = { compensated: 0, failed: 0, skipped: 0, details: [] };

  // Load instance with completed_nodes (jsonb array column)
  const instance = await instanceRepo.findByIdFull(instanceId, tenantId);
  if (!instance) {
    log.warn({ instanceId, tenantId }, "compensation: instance not found");
    return result;
  }

  const definitionId = instance.definitionId;
  if (!definitionId) {
    log.info({ instanceId }, "compensation: no definitionId — nothing to compensate");
    return result;
  }

  // completed_nodes is a jsonb column added by migration; access via raw row
  const completedNodes: string[] = (instance as unknown as Record<string, unknown>).completedNodes as string[] ?? [];
  if (completedNodes.length === 0) {
    log.info({ instanceId }, "compensation: no completed nodes");
    return result;
  }

  // Load all definition nodes for this definition
  const defNodes = await defRepo.listNodes(definitionId);
  const nodeMap = new Map(defNodes.map((n) => [n.nodeKey, n]));

  // Walk in REVERSE completion order
  const reversedNodes = [...completedNodes].reverse();

  for (const nodeKey of reversedNodes) {
    const defNode = nodeMap.get(nodeKey);
    if (!defNode) {
      result.skipped++;
      result.details.push({ nodeKey, handlerKey: "", status: "skipped", error: "node not found in definition" });
      continue;
    }

    // compensation_handler_key is a nullable varchar on definition_nodes (added by migration)
    const handlerKey = (defNode as unknown as Record<string, unknown>).compensationHandlerKey as string | null | undefined;
    if (!handlerKey) {
      result.skipped++;
      result.details.push({ nodeKey, handlerKey: "", status: "skipped" });
      continue;
    }

    const handlerNode = nodeMap.get(handlerKey);
    if (!handlerNode) {
      result.skipped++;
      result.details.push({ nodeKey, handlerKey, status: "skipped", error: "handler node not found in definition" });
      continue;
    }

    try {
      await executeHandler(instanceId, tenantId, actorId, nodeKey, handlerKey, handlerNode, instance);
      result.compensated++;
      result.details.push({ nodeKey, handlerKey, status: "compensated" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ instanceId, nodeKey, handlerKey, err: message }, "compensation handler failed");
      result.failed++;
      result.details.push({ nodeKey, handlerKey, status: "failed", error: message });
    }
  }

  // Emit audit event for the compensation run
  await enqueue(db as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId,
    actorId,
    correlationId: randomUUID(),
    payload: {
      service: "workflow",
      action: "compensation_run",
      resourceType: "instance",
      resourceId: instanceId,
      outcome: "success",
      detail: { compensated: result.compensated, failed: result.failed, skipped: result.skipped },
    },
  });

  log.info(
    { instanceId, compensated: result.compensated, failed: result.failed, skipped: result.skipped },
    "compensation run complete",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a single compensation handler node. If the handler has a message_topic
 * (message_throw pattern), we enqueue a rollback command to that topic.
 * Otherwise we record a "compensation_noted" entry in history.
 */
async function executeHandler(
  instanceId: string,
  tenantId: string,
  actorId: string,
  sourceNodeKey: string,
  handlerKey: string,
  handlerNode: Record<string, unknown>,
  instance: Record<string, unknown>,
): Promise<void> {
  const messageTopic = (handlerNode as unknown as Record<string, unknown>).messageTopic as string | null | undefined;

  if (messageTopic) {
    // Message-throw pattern: fire a rollback command to an external service
    await enqueue(db as Parameters<typeof enqueue>[0], {
      topic: messageTopic,
      eventType: "workflow.compensation.rollback",
      tenantId,
      actorId,
      correlationId: randomUUID(),
      payload: {
        instanceId,
        sourceNodeKey,
        handlerKey,
        context: instance.context ?? {},
      },
    });

    // Record in transition_history
    await historyRepo.record(db as historyRepo.Writer, {
      tenantId,
      instanceId,
      fromNode: sourceNodeKey,
      toNode: handlerKey,
      action: "compensate",
      actorId,
      detail: { messageTopic, method: "message_throw" },
    });
  } else {
    // No message topic — record as noted (future: could spawn a human task)
    await historyRepo.record(db as historyRepo.Writer, {
      tenantId,
      instanceId,
      fromNode: sourceNodeKey,
      toNode: handlerKey,
      action: "compensate",
      actorId,
      detail: { method: "compensation_noted" },
    });
  }
}

// ---------------------------------------------------------------------------
// Node completion tracking
// ---------------------------------------------------------------------------

/**
 * Append a node key to the instance's completed_nodes jsonb array.
 * Called from the tasks consumer when a node completes successfully.
 */
export async function appendCompletedNode(
  tx: Writer,
  instanceId: string,
  nodeKey: string,
): Promise<void> {
  await tx.execute(
    sql`UPDATE workflow.instances SET completed_nodes = COALESCE(completed_nodes, '[]'::jsonb) || to_jsonb(${nodeKey}::text) WHERE id = ${instanceId}`,
  );
}

import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { StageView } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { nextStageStatus } from "./domain.js";
import type { StageTransitionPayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerStageConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<StageView>(COMMANDS.createStage, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        stepNumber: p.stepNumber,
        description: p.description,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.stageCreated, { stageId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // install.stage.transition — run / skip / retry on a stage (PATCH /v1/install/steps/:id/:verb).
  queue.subscribe<StageTransitionPayload>(COMMANDS.transitionStage, async (msg) => {
    const { id } = msg.payload;
    await db.transaction((tx) => applyStageTransition(tx, msg));
    await cache.invalidate(keyFor(msg.tenantId, id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

/**
 * Apply one run/skip/retry command inside the caller's transaction. The row is read FOR UPDATE, so a
 * concurrent transition on the same step waits and then validates against the committed status.
 */
export async function applyStageTransition(tx: unknown, msg: CommandEnvelope<StageTransitionPayload>): Promise<void> {
  const { id, verb, remarks } = msg.payload;
  const t = tx as Parameters<typeof repo.findRowTx>[0];
  if (!(await markProcessed(tx as Parameters<typeof markProcessed>[0], msg.messageId))) return;
  const row = await repo.findRowTx(t, id, msg.tenantId);
  if (!row) return rejectTransition(tx, msg, "stage_not_found");
  // Re-validate inside the transaction (on the locked row): the route's check can be stale by now.
  const next = nextStageStatus(verb, row.status);
  if (!next) return rejectTransition(tx, msg, `illegal_transition_from_${row.status}`);
  const now = new Date();
  const updated = await repo.updateLifecycle(t, id, msg.tenantId, msg.actorId, row.version, {
    status: next,
    // run/retry (re)start the step and clear any previous failure; skip closes it.
    startedAt: next === "in_progress" ? now : row.startedAt,
    completedAt: next === "skipped" || next === "completed" ? now : null,
    // fail records the admin remarks as the step error; every other verb clears any previous failure.
    errorMessage: next === "failed" ? (remarks ?? "marked failed") : null,
  });
  // Row count 0 means the optimistic version guard lost a race: do not audit a success that did not happen.
  if (updated === 0) return rejectTransition(tx, msg, "version_conflict");
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "install", action: `step_${verb}`, resourceType: "stage", resourceId: id, outcome: "success", ...(remarks ? { remarks } : {}) },
  });
}

/** The caller already got a 202, so a command that cannot apply must leave a trace: audit it as rejected with a reason. */
async function rejectTransition(tx: unknown, msg: CommandEnvelope<StageTransitionPayload>, reason: string): Promise<void> {
  const { id, verb } = msg.payload;
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "install", action: `step_${verb}_rejected`, resourceType: "stage", resourceId: id, outcome: "rejected", reason },
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "install", action, resourceType: "stage", resourceId, outcome: "success" } });
}

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
    const { id, verb } = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findRowTx(tx, id, msg.tenantId);
      if (!row) return;
      // Re-validate inside the transaction: the route's check can be stale by the time we run.
      const next = nextStageStatus(verb, row.status);
      if (!next) return;
      const now = new Date();
      await repo.updateLifecycle(tx, id, msg.tenantId, msg.actorId, row.version, {
        status: next,
        // run/retry (re)start the step and clear any previous failure; skip closes it.
        startedAt: next === "in_progress" ? now : row.startedAt,
        completedAt: next === "skipped" ? now : null,
        errorMessage: null,
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "install", action: `step_${verb}`, resourceType: "stage", resourceId: id, outcome: "success" },
      });
    });
    await cache.invalidate(keyFor(msg.tenantId, id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "install", action, resourceType: "stage", resourceId, outcome: "success" } });
}

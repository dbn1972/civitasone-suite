import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS, EVENTS, RESOURCE } from "../../topics.js";
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

  // install.domain_pack_activation.record — durable per-tenant activation record (owner decision #28).
  queue.subscribe<{ id: string; domainPackKey: string; packKeys: string[]; stageId: string }>(
    COMMANDS.recordDomainPackActivation,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertActivation(tx, {
          id: p.id, tenantId: msg.tenantId, domainPackKey: p.domainPackKey, packKeys: p.packKeys,
          stageId: p.stageId, status: "accepted", createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "install", action: "domain_pack_activation_requested", resourceType: "domain_pack_activation", resourceId: p.id, outcome: "success", domainPackKey: p.domainPackKey },
        });
      });
    },
  );

  // citizen.pack.domain_activated — the outcome of citizen.pack.domain_activate (owner decision #28).
  queue.subscribe<ActivationOutcomePayload>(CONSUMED_EVENTS.citizenPackDomainActivated, async (msg) => {
    await db.transaction((tx) => applyActivationOutcome(tx, msg));
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

export type ActivationOutcomePayload = {
  activationId: string;
  stageId?: string | null;
  domainPackKey?: string;
  outcome: "completed" | "failed";
  reason?: string;
  draftIds?: string[];
};

/**
 * Move the activation record AND its Stage 3 row to the outcome citizen-service reported, in ONE
 * transaction with the inbox mark and the audit event. The record is the guard: only an `accepted`
 * row of this tenant moves, so a duplicate, stale or cross-tenant event is audited as rejected and
 * changes nothing. The stage id comes from our own record, never from the event payload.
 */
export async function applyActivationOutcome(tx: unknown, msg: CommandEnvelope<ActivationOutcomePayload>): Promise<void> {
  const t = tx as Parameters<typeof repo.findRowTx>[0];
  if (!(await markProcessed(tx as Parameters<typeof markProcessed>[0], msg.messageId))) return;
  const p = msg.payload;
  const outcome = p.outcome === "completed" ? "completed" : "failed";
  const reason = outcome === "failed" ? (p.reason ?? "activation_failed") : null;
  const moved = await repo.completeActivation(t, msg.tenantId, p.activationId, msg.actorId, {
    status: outcome, draftIds: outcome === "completed" ? (p.draftIds ?? []) : [], failureReason: reason,
  });
  const auditBase = { service: "install", resourceType: "domain_pack_activation", resourceId: p.activationId };
  if (!moved) {
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { ...auditBase, action: "domain_pack_activation_outcome_rejected", outcome: "rejected", reason: "no_pending_activation" },
    });
    return;
  }
  const stage = await repo.findRowTx(t, moved.stageId, msg.tenantId);
  if (stage && stage.status !== "completed" && stage.status !== "skipped") {
    await repo.updateLifecycle(t, stage.id, msg.tenantId, msg.actorId, stage.version, {
      status: outcome,
      completedAt: outcome === "completed" ? new Date() : null,
      errorMessage: reason,
    });
  }
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...auditBase, action: `domain_pack_activation_${outcome}`, outcome: "success", draftCount: moved.draftIds.length, ...(reason ? { reason } : {}) },
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

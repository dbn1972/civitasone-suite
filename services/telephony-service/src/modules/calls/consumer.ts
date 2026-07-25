/**
 * calls consumer — the ONLY code that writes Postgres for the call aggregate.
 *
 * Every handler:
 *   1. claims the message via markProcessed (idempotency — replays are no-ops),
 *   2. re-validates the envelope payload (defence in depth at the consume edge),
 *   3. loads the tenant-scoped row,
 *   4. enforces the state machine (illegal transitions are audited + dropped),
 *   5. enforces optimistic locking (stale expectedVersion is audited + dropped),
 *   6. enforces cross-tenant ref guards (queue/agent must live in this tenant),
 *   7. persists + emits a domain event AND an audit event in the SAME tx.
 *
 * Illegal/rejected commands NEVER throw — they emit an audit record and return,
 * so a bad command does not get retried into the DLQ and state is left intact.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as queueRepo from "../queues/repo.js";
import * as agentRepo from "../agents/repo.js";
import { assertTransition, IllegalTransitionError, type CallStatus } from "./transitions.js";
import { createCallPayload, transitionPayload, ivrHitBody, linkCallBody, recordingBody } from "./validators.js";
import type { CallInsert, CallRow } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

function secsBetween(from: Date | string | null | undefined, to: Date): number | null {
  if (!from) return null;
  const f = from instanceof Date ? from : new Date(from);
  const s = Math.floor((to.getTime() - f.getTime()) / 1000);
  return s < 0 ? 0 : s;
}

type TxLike = Parameters<typeof markProcessed>[0];

export function registerCallConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  // ---- create -------------------------------------------------------------
  queue.subscribe(COMMANDS.createCall, async (msg) => {
    const parsed = createCallPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid createCall payload: ${parsed.error.message}`);
    const p = parsed.data;
    const now = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Cross-tenant ref guards: a referenced queue/agent must live in this tenant.
      if (p.queueId && !(await queueRepo.exists(p.tenantId, p.queueId, tx))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_queue");
        return;
      }
      if (p.agentId && !(await agentRepo.exists(p.tenantId, p.agentId, tx))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_agent");
        return;
      }
      const row: CallInsert = {
        id: p.id,
        tenantId: p.tenantId,
        direction: p.direction,
        callerNumber: p.callerNumber,
        calleeNumber: p.calleeNumber,
        status: p.status,
        queueId: p.queueId,
        agentId: p.agentId,
        linkedRefType: p.linkedRefType,
        linkedRefId: p.linkedRefId,
        queuedAt: p.status === "queued" ? now : null,
        ringingAt: p.status === "ringing" ? now : null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      };
      await repo.insert(tx, row);
      await emit(tx, msg, EVENTS.callCreated, { callId: p.id, direction: p.direction, status: p.status }, "create", p.id);
    });
    await refreshCache(msg.tenantId, p.id);
  });

  // ---- lifecycle transitions ---------------------------------------------
  queue.subscribe(COMMANDS.ringCall, (msg) =>
    handleTransition(msg, "ringing", EVENTS.callRinging, "ring", (row, p, now) => ({
      status: "ringing",
      ringingAt: now,
      ...(p.queueId !== undefined ? { queueId: p.queueId } : {}),
      ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
    })),
  );

  queue.subscribe(COMMANDS.answerCall, (msg) =>
    handleTransition(
      msg,
      "answered",
      EVENTS.callAnswered,
      "answer",
      (row, p, now) => ({
        status: "answered",
        answeredAt: now,
        agentId: p.agentId ?? row.agentId,
        waitSeconds: secsBetween(row.queuedAt ?? row.ringingAt ?? row.createdAt, now),
      }),
      { requireAgent: true },
    ),
  );

  queue.subscribe(COMMANDS.completeCall, (msg) =>
    handleTransition(
      msg,
      "completed",
      EVENTS.callCompleted,
      "complete",
      (row, p, now) => ({
        status: "completed",
        endedAt: now,
        disposition: p.disposition ?? "no_resolution",
        talkSeconds: p.talkSeconds ?? secsBetween(row.answeredAt, now),
      }),
      { requireDisposition: true },
    ),
  );

  queue.subscribe(COMMANDS.missCall, (msg) =>
    handleTransition(msg, "missed", EVENTS.callMissed, "miss", (row, p, now) => ({
      status: "missed",
      endedAt: now,
      waitSeconds: secsBetween(row.queuedAt ?? row.ringingAt ?? row.createdAt, now),
    })),
  );

  queue.subscribe(COMMANDS.abandonCall, (msg) =>
    handleTransition(msg, "abandoned", EVENTS.callAbandoned, "abandon", (row, p, now) => ({
      status: "abandoned",
      endedAt: now,
      waitSeconds: secsBetween(row.queuedAt ?? row.ringingAt ?? row.createdAt, now),
    })),
  );

  // ---- routing / enrichment (no state change) -----------------------------
  queue.subscribe(COMMANDS.assignCall, async (msg) => {
    const parsed = transitionPayload.safeParse(msg.payload);
    if (!parsed.success) throw new Error(`invalid assign payload: ${parsed.error.message}`);
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findRow(p.id, p.tenantId, tx);
      if (!row) return void (await emitAudit(tx, msg, "assign", p.id, "rejected_not_found"));
      if (p.queueId && !(await queueRepo.exists(p.tenantId, p.queueId, tx)))
        return void (await emitAudit(tx, msg, "assign", p.id, "rejected_cross_tenant_queue"));
      if (p.agentId && !(await agentRepo.exists(p.tenantId, p.agentId, tx)))
        return void (await emitAudit(tx, msg, "assign", p.id, "rejected_cross_tenant_agent"));
      if (versionConflict(row, p.expectedVersion))
        return void (await emitAudit(tx, msg, "assign", p.id, "rejected_version_conflict"));
      const patch: Partial<CallInsert> = {};
      if (p.queueId !== undefined) patch.queueId = p.queueId;
      if (p.agentId !== undefined) patch.agentId = p.agentId;
      const n = await repo.applyUpdate(tx, p.id, p.tenantId, p.expectedVersion ?? row.version, patch, msg.actorId);
      if (n === 0) return void (await emitAudit(tx, msg, "assign", p.id, "rejected_version_conflict"));
      await emit(tx, msg, EVENTS.callAssigned, { callId: p.id, queueId: p.queueId, agentId: p.agentId }, "assign", p.id);
    });
    await refreshCache(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.recordIvrHit, async (msg) => {
    const parsed = ivrHitBody.safeParse(msg.payload);
    const id = (msg.payload as { id?: string }).id;
    if (!parsed.success || !id) throw new Error("invalid ivr_hit payload");
    const hit = { menuKey: parsed.data.menuKey, digit: parsed.data.digit, at: new Date().toISOString() };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findRow(id, msg.tenantId, tx);
      if (!row) return void (await emitAudit(tx, msg, "ivr_hit", id, "rejected_not_found"));
      await repo.appendIvrHit(tx, id, msg.tenantId, hit, msg.actorId);
      await emit(tx, msg, EVENTS.callIvrRecorded, { callId: id, menuKey: hit.menuKey, digit: hit.digit }, "ivr_hit", id);
    });
    await refreshCache(msg.tenantId, id);
  });

  queue.subscribe(COMMANDS.linkCall, async (msg) => {
    const parsed = linkCallBody.safeParse(msg.payload);
    const id = (msg.payload as { id?: string }).id;
    if (!parsed.success || !id) throw new Error("invalid link payload");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findRow(id, msg.tenantId, tx);
      if (!row) return void (await emitAudit(tx, msg, "link", id, "rejected_not_found"));
      await repo.applyUpdate(
        tx,
        id,
        msg.tenantId,
        row.version,
        { linkedRefType: parsed.data.refType, linkedRefId: parsed.data.refId },
        msg.actorId,
      );
      await emit(tx, msg, EVENTS.callLinked, { callId: id, refType: parsed.data.refType, refId: parsed.data.refId }, "link", id);
    });
    await refreshCache(msg.tenantId, id);
  });

  queue.subscribe(COMMANDS.attachRecording, async (msg) => {
    const parsed = recordingBody.safeParse(msg.payload);
    const id = (msg.payload as { id?: string }).id;
    if (!parsed.success || !id) throw new Error("invalid recording payload");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findRow(id, msg.tenantId, tx);
      if (!row) return void (await emitAudit(tx, msg, "recording", id, "rejected_not_found"));
      await repo.applyUpdate(
        tx,
        id,
        msg.tenantId,
        row.version,
        {
          recordingId: parsed.data.recordingId,
          recordingUrl: parsed.data.recordingUrl ?? null,
          recordingDurationSec: parsed.data.durationSec ?? null,
          recordingFormat: parsed.data.format ?? null,
        },
        msg.actorId,
      );
      await emit(tx, msg, EVENTS.callRecordingAttached, { callId: id, recordingId: parsed.data.recordingId }, "recording", id);
    });
    await refreshCache(msg.tenantId, id);
  });
}

/** Shared lifecycle-transition handler with state machine + optimistic locking. */
async function handleTransition(
  msg: CommandEnvelope,
  target: CallStatus,
  event: string,
  action: string,
  buildPatch: (row: CallRow, p: ReturnType<typeof transitionPayload.parse>, now: Date) => Partial<CallInsert>,
  opts: { requireAgent?: boolean; requireDisposition?: boolean } = {},
): Promise<void> {
  const parsed = transitionPayload.safeParse(msg.payload);
  if (!parsed.success) throw new Error(`invalid ${action} payload: ${parsed.error.message}`);
  const p = parsed.data;
  const now = new Date();
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const row = await repo.findRow(p.id, p.tenantId, tx);
    if (!row) return void (await emitAudit(tx, msg, action, p.id, "rejected_not_found"));

    // State machine: reject illegal moves (audited, not thrown).
    try {
      assertTransition(row.status as CallStatus, target);
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return void (await emitAudit(tx, msg, action, p.id, `rejected_illegal_transition:${row.status}->${target}`));
      }
      throw err;
    }

    if (opts.requireAgent && !p.agentId && !row.agentId)
      return void (await emitAudit(tx, msg, action, p.id, "rejected_missing_agent"));
    if (opts.requireDisposition && !p.disposition)
      return void (await emitAudit(tx, msg, action, p.id, "rejected_missing_disposition"));

    // Optimistic lock: a stale expectedVersion is rejected.
    if (versionConflict(row, p.expectedVersion))
      return void (await emitAudit(tx, msg, action, p.id, "rejected_version_conflict"));

    // Cross-tenant agent guard on answer/route.
    if (p.agentId && !(await agentRepo.exists(p.tenantId, p.agentId, tx)))
      return void (await emitAudit(tx, msg, action, p.id, "rejected_cross_tenant_agent"));

    const n = await repo.applyUpdate(tx, p.id, p.tenantId, p.expectedVersion ?? row.version, buildPatch(row, p, now), msg.actorId);
    if (n === 0) return void (await emitAudit(tx, msg, action, p.id, "rejected_version_conflict"));
    await emit(tx, msg, event, { callId: p.id, status: target, ...(p.disposition ? { disposition: p.disposition } : {}) }, action, p.id);
  });
  await refreshCache(msg.tenantId, p.id);
}

function versionConflict(row: CallRow, expectedVersion: number | undefined): boolean {
  return expectedVersion !== undefined && row.version !== expectedVersion;
}

async function refreshCache(tenantId: string, id: string): Promise<void> {
  const view = await repo.findView(id, tenantId);
  if (view) await cache.put(keyFor(tenantId, id), view);
  await cache.invalidateResource(tenantId, RESOURCE);
}

async function emit(
  tx: TxLike,
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
    payload: { service: "telephony", action, resourceType: "call", resourceId, outcome: "success" },
  });
}

/** Audit-only emit (no domain event) — used for rejected/validation outcomes. */
async function emitAudit(
  tx: TxLike,
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
    payload: { service: "telephony", action, resourceType: "call", resourceId, outcome },
  });
}

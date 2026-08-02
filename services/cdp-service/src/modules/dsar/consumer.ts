/**
 * dsar/consumer.ts — CDP-011 handlers for raise + complete.
 */
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as deviceRepo from "../identity/device-repo.js";
import * as identityRepo from "../identity/repo.js";
import * as membershipRepo from "../segments/membership-repo.js";
import { DSAR_REQUEST_TYPES, requiresDownstreamPurge } from "./domain.js";

const log = pino({ name: "cdp.dsar.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

const raiseSchema = z.object({
  dsarId: z.string().uuid(),
  profileId: z.string().uuid(),
  requestType: z.enum(DSAR_REQUEST_TYPES),
  reason: z.string().nullable().optional(),
});

const completeSchema = z.object({
  dsarId: z.string().uuid(),
  version: z.number().int().min(1),
  note: z.string().optional(),
});

export async function handleRaiseDsar(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = raiseSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ messageId: msg.messageId, outcome: "skipped_invalid_payload" }, "dsar raise rejected");
    return;
  }
  const p = parsed.data;
  const purged = { deviceTokens: 0, identityLinks: 0, memberships: 0 };
  let started = false;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await repo.insert(tx, {
      id: p.dsarId,
      tenantId: msg.tenantId,
      profileId: p.profileId,
      requestType: p.requestType,
      status: "pending",
      reason: p.reason ?? null,
    });

    await enqueue(tx, {
      topic: EVENTS.dsarRaised,
      eventType: EVENTS.dsarRaised,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { dsarId: p.dsarId, profileId: p.profileId, requestType: p.requestType, status: "pending" },
    });

    const ok = await repo.startProcessing(tx, p.dsarId, msg.tenantId, 1);
    if (!ok) return;

    if (p.requestType === "erasure") {
      purged.deviceTokens = await deviceRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
      purged.identityLinks = await identityRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
    }
    if (requiresDownstreamPurge(p.requestType)) {
      purged.memberships = await membershipRepo.deleteByProfile(tx, p.profileId, msg.tenantId);
    }

    await enqueue(tx, {
      topic: EVENTS.dsarInProgress,
      eventType: EVENTS.dsarInProgress,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        dsarId: p.dsarId,
        profileId: p.profileId,
        requestType: p.requestType,
        status: "in_progress",
        purgeDownstream: requiresDownstreamPurge(p.requestType),
        purged: { ...purged },
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "dsar_raised",
      resourceType: "dsar_request",
      resourceId: p.dsarId,
      details: { profileId: p.profileId, requestType: p.requestType, purged },
    });
    started = true;
  });

  if (started) {
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile", p.profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_lineage", p.profileId));
  }
  log.info({ dsarId: p.dsarId, started }, "dsar raise handled");
}

export async function handleCompleteDsar(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = completeSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ messageId: msg.messageId, outcome: "skipped_invalid_payload" }, "dsar complete rejected");
    return;
  }
  const p = parsed.data;
  const completedAt = new Date();

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const existing = await repo.findById(p.dsarId, msg.tenantId);
    if (!existing) return;
    const ok = await repo.complete(tx, p.dsarId, msg.tenantId, p.version, completedAt);
    if (!ok) return;

    await enqueue(tx, {
      topic: EVENTS.dsarCompleted,
      eventType: EVENTS.dsarCompleted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        dsarId: p.dsarId,
        profileId: existing.profileId,
        requestType: existing.requestType,
        completedAt: completedAt.toISOString(),
        purgeDownstream: requiresDownstreamPurge(existing.requestType),
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "dsar_completed",
      resourceType: "dsar_request",
      resourceId: p.dsarId,
      details: { note: p.note ?? null },
    });
  });
  log.info({ dsarId: p.dsarId }, "dsar complete handled");
}

export function registerDsarConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.raiseDsar, handleRaiseDsar);
  queue.subscribe(COMMANDS.completeDsar, handleCompleteDsar);
}

/**
 * nba/consumer.ts — handlers for recommendation.nba.* commands.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as feedbackRepo from "../feedback/repo.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface NbaCreatePayload {
  id: string;
  profileId: string;
  recommendationType: string;
  productId: string | null;
  channel: string | null;
  score: number;
  servedAt: string;
}

export interface NbaAcceptPayload {
  id: string;
  version: number;
  feedbackId: string;
}

export interface NbaRejectPayload {
  id: string;
  version: number;
  feedbackId: string;
  reasonCode: string;
  reasonText: string | null;
  reason: string;
}

export async function handleNbaCreate(msg: CommandEnvelope<NbaCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      profileId: p.profileId,
      recommendationType: p.recommendationType,
      productId: p.productId,
      channel: p.channel,
      score: Number(p.score).toFixed(4),
      status: "served",
      servedAt: new Date(p.servedAt),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.recommendationServed,
      eventType: EVENTS.recommendationServed,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        recommendationId: p.id,
        profileId: p.profileId,
        recommendationType: p.recommendationType,
        score: p.score,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "nba.create",
      resourceType: "recommendation",
      resourceId: p.id,
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "recommendation", p.id));
}

export async function handleNbaAccept(msg: CommandEnvelope<NbaAcceptPayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const existing = await repo.findById(p.id, msg.tenantId);
    if (!existing) return;
    const ok = await repo.updateStatus(
      tx,
      p.id,
      msg.tenantId,
      { status: "accepted", updatedBy: msg.actorId },
      p.version,
    );
    if (!ok) return;
    await feedbackRepo.insert(tx, {
      id: p.feedbackId,
      tenantId: msg.tenantId,
      recommendationId: p.id,
      action: "accepted",
      reason: null,
      reasonCode: null,
      reasonText: null,
      recordedAt: new Date(),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.recommendationAccepted,
      eventType: EVENTS.recommendationAccepted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { recommendationId: p.id, profileId: existing.profileId, feedbackId: p.feedbackId },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "nba.accept",
      resourceType: "recommendation",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "recommendation", p.id));
}

export async function handleNbaReject(msg: CommandEnvelope<NbaRejectPayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const existing = await repo.findById(p.id, msg.tenantId);
    if (!existing) return;
    const ok = await repo.updateStatus(
      tx,
      p.id,
      msg.tenantId,
      { status: "rejected", updatedBy: msg.actorId },
      p.version,
    );
    if (!ok) return;
    await feedbackRepo.insert(tx, {
      id: p.feedbackId,
      tenantId: msg.tenantId,
      recommendationId: p.id,
      action: "rejected",
      reason: p.reason,
      reasonCode: p.reasonCode,
      reasonText: p.reasonText,
      recordedAt: new Date(),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.recommendationRejected,
      eventType: EVENTS.recommendationRejected,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        recommendationId: p.id,
        profileId: existing.profileId,
        feedbackId: p.feedbackId,
        reasonCode: p.reasonCode,
        hasReasonText: p.reasonText !== null,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "nba.reject",
      resourceType: "recommendation",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "recommendation", p.id));
}

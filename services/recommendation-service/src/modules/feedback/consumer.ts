import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as nbaRepo from "../nba/repo.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface FeedbackRecordPayload {
  id: string;
  recommendationId: string;
  action: "accepted" | "rejected";
  reason: string | null;
  version: number;
  recordedAt: string;
}

export async function handleFeedbackRecord(
  msg: CommandEnvelope<FeedbackRecordPayload>,
): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      recommendationId: p.recommendationId,
      action: p.action,
      reason: p.reason,
      recordedAt: new Date(p.recordedAt),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    const ok = await nbaRepo.updateStatus(
      tx,
      p.recommendationId,
      msg.tenantId,
      { status: p.action, updatedBy: msg.actorId },
      p.version,
    );
    if (!ok) return;
    await enqueue(tx, {
      topic: EVENTS.feedbackRecorded,
      eventType: EVENTS.feedbackRecorded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        feedbackId: p.id,
        recommendationId: p.recommendationId,
        action: p.action,
        hasReason: p.reason !== null,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "feedback.record",
      resourceType: "recommendation_feedback",
      resourceId: p.id,
    });
    applied = true;
  });
  if (applied) {
    await cache.invalidate(cache.makeKey(msg.tenantId, "recommendation", p.recommendationId));
  }
}

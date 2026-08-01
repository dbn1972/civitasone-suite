/**
 * collateral/consumer.ts — CR-AI-02 handler for recommendation.collateral.attach.
 *
 * Command → consumer → outbox event, so the HTTP route can answer 202 without
 * holding a write transaction open. markProcessed() runs FIRST inside the
 * transaction: a redelivered message is skipped rather than double-inserted.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

export interface AttachCollateralPayload {
  linkId: string;
  recommendationId: string;
  collateralType: string;
  collateralRef: string;
  title: string;
  ordinal: number;
}

export async function handleAttachCollateral(msg: CommandEnvelope<AttachCollateralPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    // Idempotency gate — must be the first statement in the transaction.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    await repo.insert(tx, {
      id: p.linkId,
      tenantId: msg.tenantId,
      recommendationId: p.recommendationId,
      collateralType: p.collateralType,
      collateralRef: p.collateralRef,
      title: p.title,
      ordinal: p.ordinal,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.collateralAttached,
      eventType: EVENTS.collateralAttached,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        linkId: p.linkId,
        recommendationId: p.recommendationId,
        collateralType: p.collateralType,
      },
    });
  });

  // Outside the transaction: a missed invalidation self-heals via the bounded TTL.
  await cache.invalidate(cache.makeKey(msg.tenantId, "collateral", p.recommendationId));
}

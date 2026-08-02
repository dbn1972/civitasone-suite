/**
 * collateral/consumer.ts — CR-AI-02 handlers for attach/detach.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface AttachCollateralPayload {
  linkId: string;
  recommendationId: string;
  collateralType: string;
  collateralRef: string;
  title: string;
  ordinal: number;
}

export interface DetachCollateralPayload {
  linkId: string;
}

export async function handleAttachCollateral(
  msg: CommandEnvelope<AttachCollateralPayload>,
): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
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
    await writeAudit(tx, ctxOf(msg), {
      action: "collateral.attach",
      resourceType: "collateral_link",
      resourceId: p.linkId,
    });
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, "collateral", p.recommendationId));
}

export async function handleDetachCollateral(
  msg: CommandEnvelope<DetachCollateralPayload>,
): Promise<void> {
  const p = msg.payload;
  let recommendationId: string | null = null;
  await db.transaction(async (tx) => {
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    const existing = await repo.findById(p.linkId, msg.tenantId);
    if (!existing) return;
    recommendationId = existing.recommendationId;

    const ok = await repo.deleteById(tx, p.linkId, msg.tenantId);
    if (!ok) return;

    await enqueue(tx, {
      topic: EVENTS.collateralDetached,
      eventType: EVENTS.collateralDetached,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { linkId: p.linkId, recommendationId: existing.recommendationId },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "collateral.detach",
      resourceType: "collateral_link",
      resourceId: p.linkId,
    });
  });

  if (recommendationId) {
    await cache.invalidate(cache.makeKey(msg.tenantId, "collateral", recommendationId));
  }
}

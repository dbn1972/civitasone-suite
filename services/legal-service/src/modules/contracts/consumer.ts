import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanClear } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerContractConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.contractReviewCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractRef: string; subject: string;
      valueMinor: number; currency?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReview(tx, {
        id: p.id, tenantId: p.tenantId, contractRef: p.contractRef, subject: p.subject,
        valueMinor: BigInt(p.valueMinor), currency: p.currency ?? "INR", status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "contract_review", p.id);
    });
  });

  queue.subscribe(COMMANDS.contractReviewClear, async (msg) => {
    const p = msg.payload as { reviewId: string; tenantId: string; clearanceType: string; notes?: string };
    const now = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const review = await repo.findReviewByIdTx(tx, p.reviewId);
      if (!review) throw new Error(`review ${p.reviewId} not found`);
      assertCanClear(review.status ?? "pending");
      await repo.insertClearance(tx, {
        id: randomUUID(), tenantId: p.tenantId, reviewId: p.reviewId,
        clearanceType: p.clearanceType, notes: p.notes ?? null, clearedAt: now,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateReview(tx, p.reviewId, {
        status: "cleared", clearedAt: now, updatedBy: msg.actorId, version: (review.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.contractReviewCleared, eventType: EVENTS.contractReviewCleared,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { reviewId: p.reviewId, contractRef: review.contractRef, valueMinor: Number(review.valueMinor ?? 0n) },
      });
      await audit(tx, msg, "clear", "contract_review", p.reviewId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract_review", p.reviewId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}

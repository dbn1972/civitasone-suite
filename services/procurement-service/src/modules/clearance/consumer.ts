import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";

export type LegalClearance = {
  reviewId: string;
  contractRef: string;
  valueMinor: number;
  clearedAt: string;
};

/** legal-service → procurement: cache contract clearance for high-value PO gate */
export function registerClearanceConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.legalContractCleared, async (msg) => {
    const p = msg.payload as {
      reviewId: string; contractRef: string; valueMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const record: LegalClearance = {
        reviewId: p.reviewId,
        contractRef: p.contractRef,
        valueMinor: p.valueMinor,
        clearedAt: new Date().toISOString(),
      };
      await cache.put(
        cache.makeKey(msg.tenantId, "legal_clearance", p.reviewId),
        record,
        86400,
      );
    });
  });
}

/** Returns cached clearance if present (used by PO consumer). */
export async function getLegalClearance(tenantId: string, reviewId: string): Promise<LegalClearance | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "legal_clearance", reviewId),
    async () => null,
  );
}

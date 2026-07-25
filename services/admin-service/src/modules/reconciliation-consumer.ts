/**
 * Reconciliation consumer — processes reconciliation results from packages/reconciliation.
 * Consumes: admin.reconciliation.complete
 * Persists break reports for dashboard visibility.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";

const log = pino({ name: "reconciliation-consumer" });

export function registerReconciliationConsumers(q: Queue): void {
  q.subscribe("admin.reconciliation.complete", async (msg) => {
    const p = msg.payload as { reconciliationId: string; tenantId: string; breakCount: number; matchedCount: number; sourceSystem: string };
    log.info({ reconciliationId: p.reconciliationId, breaks: p.breakCount, matched: p.matchedCount }, "reconciliation completed");
    // In production: persist results, notify if breaks > threshold
  });

  q.subscribe("admin.reconciliation.break_detected", async (msg) => {
    const p = msg.payload as { reconciliationId: string; breakType: string; sourceKey: string; detail: string };
    log.warn({ reconciliationId: p.reconciliationId, breakType: p.breakType, key: p.sourceKey }, "reconciliation break detected");
  });
}

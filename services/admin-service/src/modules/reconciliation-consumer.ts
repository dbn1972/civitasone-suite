import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../shared/db.js";
import { markProcessed } from "../shared/outbox.js";
import { sql } from "drizzle-orm";

const log = pino({ name: "reconciliation-consumer" });

export function registerReconciliationConsumers(q: Queue): void {
  q.subscribe("admin.reconciliation.complete", async (msg) => {
    const p = msg.payload as { reconciliationId: string; tenantId: string; breakCount: number; matchedCount: number; sourceSystem: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Persist the reconciliation result
      await tx.execute(sql`
        INSERT INTO admin.reconciliation_results (id, tenant_id, break_count, matched_count, source_system, completed_at)
        VALUES (${p.reconciliationId}, ${p.tenantId}, ${p.breakCount}, ${p.matchedCount}, ${p.sourceSystem}, NOW())
        ON CONFLICT (id) DO UPDATE SET break_count = EXCLUDED.break_count, matched_count = EXCLUDED.matched_count, completed_at = NOW()
      `);
      log.info({ reconciliationId: p.reconciliationId, breaks: p.breakCount, matched: p.matchedCount }, "reconciliation result persisted");
    });
  });

  q.subscribe("admin.reconciliation.break_detected", async (msg) => {
    const p = msg.payload as { reconciliationId: string; tenantId: string; breakType: string; sourceKey: string; detail: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO admin.reconciliation_breaks (id, reconciliation_id, tenant_id, break_type, source_key, detail)
        VALUES (gen_random_uuid(), ${p.reconciliationId}, ${p.tenantId}, ${p.breakType}, ${p.sourceKey}, ${p.detail})
      `);
      log.warn({ reconciliationId: p.reconciliationId, breakType: p.breakType, key: p.sourceKey }, "break persisted");
    });
  });
}

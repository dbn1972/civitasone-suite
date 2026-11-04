/**
 * UAT P3 b19 D-15: payroll.deductor.update -> payroll_settings.deductor_name /
 * deductor_tan / deductor_pan, with a before / after audit event, in ONE
 * transaction. The route already validated the identity; it is re-validated
 * here and an invalid command is dead-lettered (it can never succeed on retry).
 */
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { deductorProblems, normaliseDeductor } from "./domain.js";
import { loadTenantDeductorTx } from "./repo.js";

const log = pino({ name: "payroll-deductor-config-consumer" });
const AUDIT = "audit.event.record";

export interface DeductorUpdatePayload {
  tenantId: string; name: string; tan: string; pan: string; reason?: string | null;
}

export function registerDeductorConfigConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.deductorUpdate, async (msg) => {
    const p = msg.payload as DeductorUpdatePayload;
    try {
      const next = normaliseDeductor(p);
      const problems = deductorProblems(next);
      if (problems.length > 0) throw new NonRetryableError(`deductor update rejected: ${problems.join("; ")}`);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`SELECT 1 FROM payroll.payroll_settings WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE`);
        const prev = await loadTenantDeductorTx(tx, p.tenantId);
        const before = prev.name === null && prev.tan === null && prev.pan === null ? null : { name: prev.name, tan: prev.tan, pan: prev.pan };
        await tx.execute(sql`
          INSERT INTO payroll.payroll_settings (tenant_id, deductor_name, deductor_tan, deductor_pan, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, ${next.name}, ${next.tan}, ${next.pan}, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE
            SET deductor_name = EXCLUDED.deductor_name, deductor_tan = EXCLUDED.deductor_tan,
                deductor_pan = EXCLUDED.deductor_pan, updated_at = NOW()
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll", action: "deductor_updated", resourceType: "payroll_settings", resourceId: p.tenantId,
            outcome: "success",
            detail: { before, after: { name: next.name, tan: next.tan, pan: next.pan }, reason: p.reason ?? null },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deductorUpdate failed");
      throw err;
    }
  });
}

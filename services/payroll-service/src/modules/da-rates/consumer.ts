import { NonRetryableError, type Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import type { CreateDaRateBody } from "./api.js";
import { loadDaRates, lockDaRates, processedMonthsUsingRate } from "./rules.js";

export function registerDaRateConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.daRateCreate, async (msg) => {
    const p = msg.payload as CreateDaRateBody & { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = (await tx.execute(sql`
        INSERT INTO payroll.dearness_allowance_rates (id, tenant_id, effective_from, rate_bps, order_ref)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.effectiveFrom}::date, ${p.rateBps}, ${p.orderRef})
        ON CONFLICT (tenant_id, effective_from) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (inserted.length === 0) throw new NonRetryableError(`DA_RATE_EXISTS_FOR_DATE: tenant already has a DA rate effective ${p.effectiveFrom}`);
      await audit(tx, msg, "create", "dearness_allowance_rates", p.id, {
        effectiveFrom: p.effectiveFrom, rateBps: p.rateBps, orderRef: p.orderRef,
      });
    });
  });

  queue.subscribe(COMMANDS.daRateDelete, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lockDaRates(tx, msg.tenantId, "exclusive");
      const all = await loadDaRates(tx, msg.tenantId);
      const rate = all.find((r) => r.id === p.id);
      if (!rate) throw new NonRetryableError("NOT_FOUND: DA rate not found");
      const used = await processedMonthsUsingRate(tx, msg.tenantId, rate, all);
      if (used.length > 0) throw new NonRetryableError(`DA_RATE_IN_USE: used by processed payroll for ${used.join(", ")}`);
      await tx.execute(sql`DELETE FROM payroll.dearness_allowance_rates WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      await audit(tx, msg, "delete", "dearness_allowance_rates", p.id, {
        effectiveFrom: rate.effectiveFrom, rateBps: rate.rateBps, orderRef: rate.orderRef,
      });
    });
  });
}

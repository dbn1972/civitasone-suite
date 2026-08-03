import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "finance.recurring.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerRecurringConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.recurringEntryCreate, async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; name: string; voucherType?: string;
      frequency?: string; debitAccountId: string; creditAccountId: string;
      amountMinor: number; narration?: string; nextRunDate: string; endDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      const id = p.id ?? msg.messageId;
      await (tx as any).execute(sql`
        INSERT INTO gl.finance_recurring_entries (
          id, tenant_id, name, voucher_type, frequency, debit_account_id, credit_account_id,
          amount_minor, narration, next_run_date, end_date, created_by
        ) VALUES (
          ${id}::uuid, ${p.tenantId}::uuid, ${p.name}, ${p.voucherType ?? "journal"},
          ${p.frequency ?? "monthly"}, ${p.debitAccountId}::uuid, ${p.creditAccountId}::uuid,
          ${p.amountMinor}::bigint, ${p.narration ?? null},
          ${p.nextRunDate}::date, ${p.endDate ?? null}::date, ${msg.actorId}::uuid
        )
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: "finance.recurring.entry_created", eventType: "finance.recurring.entry_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, name: p.name, frequency: p.frequency ?? "monthly" },
      });
      await audit(tx, msg, "create", "recurring_entry", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:recurring:*`);
    log.info({ id: msg.messageId }, "Processed recurring.entry_create");
  });

  queue.subscribe(COMMANDS.recurringEntryUpdate, async (msg) => {
    const p = msg.payload as {
      tenantId: string; id: string; name?: string; frequency?: string;
      amountMinor?: number; narration?: string; nextRunDate?: string;
      endDate?: string | null; isActive?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { sql } = await import("drizzle-orm");
      await (tx as any).execute(sql`
        UPDATE gl.finance_recurring_entries
        SET
          name = COALESCE(${p.name ?? null}, name),
          frequency = COALESCE(${p.frequency ?? null}, frequency),
          amount_minor = COALESCE(${p.amountMinor ?? null}::bigint, amount_minor),
          narration = COALESCE(${p.narration ?? null}, narration),
          next_run_date = COALESCE(${p.nextRunDate ?? null}::date, next_run_date),
          end_date = ${p.endDate === undefined ? sql`end_date` : p.endDate === null ? sql`NULL` : sql`${p.endDate}::date`},
          is_active = COALESCE(${p.isActive ?? null}::boolean, is_active)
        WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
      `);
      await enqueue(tx, {
        topic: "finance.recurring.entry_updated", eventType: "finance.recurring.entry_updated",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id },
      });
      await audit(tx, msg, "update", "recurring_entry", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:recurring:*`);
    log.info({ id: msg.messageId }, "Processed recurring.entry_update");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}

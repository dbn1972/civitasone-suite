/**
 * V4-B-01: comp-off persistence consumers (earn / redeem).
 * Each handler runs in ONE transaction: markProcessed (per-command messageId)
 * + guarded write + audit event, under the message tenant RLS context.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { hrmsCompOff } from "./schema.js";

const log = pino({ name: "hrms-comp-off-consumer" });
const AUDIT = "audit.event.record";

export function registerCompOffConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.compOffEarn, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; workedDate: string;
      holidayName: string; hours: number; reason: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(hrmsCompOff).values({
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId, workedDate: p.workedDate,
        holidayName: p.holidayName, hours: p.hours, reason: p.reason,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: hrmsCompOff.id });
      if (inserted.length === 0) {
        log.warn({ employeeId: p.employeeId, workedDate: p.workedDate }, "comp-off already granted for this day; skipped");
        return;
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "create", resourceType: "comp_off", resourceId: p.id, outcome: "success",
          metadata: { employeeId: p.employeeId, workedDate: p.workedDate, hours: p.hours },
        },
      });
    });
  });

  queue.subscribe(COMMANDS.compOffRedeem, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; ownerEmployeeId: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const conds = [
        eq(hrmsCompOff.id, p.id), eq(hrmsCompOff.tenantId, p.tenantId), eq(hrmsCompOff.status, "available"),
      ];
      if (p.ownerEmployeeId) conds.push(eq(hrmsCompOff.employeeId, p.ownerEmployeeId));
      // Guarded write: only an available (and, for non-HR, own) entry flips, exactly once.
      const updated = await tx.update(hrmsCompOff).set({
        status: "redeemed", redeemedAt: new Date(), updatedAt: new Date(), updatedBy: msg.actorId,
        version: sql`${hrmsCompOff.version} + 1`,
      }).where(and(...conds)).returning({ id: hrmsCompOff.id, employeeId: hrmsCompOff.employeeId });
      const row = updated[0];
      if (!row) {
        log.warn({ id: p.id }, "comp-off redeem was a no-op (missing, not available, or not owned)");
        return;
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "redeem", resourceType: "comp_off", resourceId: p.id, outcome: "success",
          metadata: { employeeId: row.employeeId },
        },
      });
    });
  });
}

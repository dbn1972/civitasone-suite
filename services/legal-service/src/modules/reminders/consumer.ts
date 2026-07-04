import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { legalReminders } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerReminderConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.reminderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseId: string; remindAt: string; message: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(legalReminders).values({
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        remindAt: new Date(p.remindAt),
        message: p.message,
        sent: false,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: "legal.reminder.created",
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { action: "create", resource: "reminder", resourceId: p.id, caseId: p.caseId, remindAt: p.remindAt },
      });
    });
  });
}

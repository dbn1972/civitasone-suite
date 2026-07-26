import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { validateScheduledAt } from "./domain.js";
import { scheduledNotifications } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSchedulingConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{
    id: string; tenantId: string; templateId: string; recipient: string;
    recipientId?: string; channel: string; priority?: string;
    variables?: Record<string, unknown>; scheduledAt: string;
  }>(COMMANDS.scheduleNotification, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (!validateScheduledAt(p.scheduledAt)) {
        throw new NonRetryableError("INVALID_SCHEDULE", "scheduledAt must be a valid future timestamp");
      }

      await tx.insert(scheduledNotifications).values({
        id: p.id,
        tenantId: p.tenantId,
        templateId: p.templateId,
        recipient: p.recipient,
        recipientId: p.recipientId ?? null,
        channel: p.channel,
        priority: p.priority ?? "normal",
        variables: p.variables ?? {},
        scheduledAt: new Date(p.scheduledAt),
        status: "scheduled",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.scheduled,
        eventType: EVENTS.scheduled,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { scheduleId: p.id, scheduledAt: p.scheduledAt },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "schedule_notification", resourceType: "scheduled_notification", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "schedules_list", msg.tenantId));
  });

  q.subscribe<{ id: string; tenantId: string }>(
    COMMANDS.cancelSchedule, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        const { eq, and } = await import("drizzle-orm");
        const rows = await tx.select().from(scheduledNotifications)
          .where(and(
            eq(scheduledNotifications.id, p.id),
            eq(scheduledNotifications.tenantId, p.tenantId),
            eq(scheduledNotifications.status, "scheduled"),
          ))
          .limit(1);

        if (!rows[0]) return; // Already cancelled or does not exist — idempotent

        await tx.update(scheduledNotifications).set({
          status: "cancelled",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
          version: rows[0].version + 1,
        }).where(and(
          eq(scheduledNotifications.id, p.id),
          eq(scheduledNotifications.version, rows[0].version),
        ));

        await enqueue(tx, {
          topic: EVENTS.scheduleCancelled,
          eventType: EVENTS.scheduleCancelled,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { scheduleId: p.id },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "cancel_schedule", resourceType: "scheduled_notification", resourceId: p.id, outcome: "success" },
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "schedules_list", msg.tenantId));
    },
  );
}

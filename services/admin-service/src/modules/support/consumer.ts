import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { breakGlassExpiresAt } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.alert.send";

export function registerSupportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; ticketId: string; reason: string; actorId: string }>(COMMANDS.breakGlassOpen, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const openedAt = new Date();
      const expiresAt = breakGlassExpiresAt(openedAt);
      await repo.insertBreakGlass(tx, {
        id: msg.payload.id, tenantId: msg.payload.tenantId, ticketId: msg.payload.ticketId,
        actorId: msg.payload.actorId, reason: msg.payload.reason,
        openedAt, expiresAt, correlationId: msg.correlationId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.breakGlassOpened, eventType: EVENTS.breakGlassOpened,
        tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { breakGlassId: msg.payload.id, tenantId: msg.payload.tenantId, ticketId: msg.payload.ticketId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "admin", action: "breakglass_open", resourceType: "break_glass", resourceId: msg.payload.id, outcome: "success" },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_TOPIC, eventType: NOTIFICATION_TOPIC,
        tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { alert: "break_glass_opened", tenantId: msg.payload.tenantId, ticketId: msg.payload.ticketId },
      });
    });
  });

  queue.subscribe<{ id: string }>(COMMANDS.breakGlassClose, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.closeBreakGlass(tx, msg.payload.id, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "admin", action: "breakglass_close", resourceType: "break_glass", resourceId: msg.payload.id, outcome: "success" },
      });
    });
  });
}

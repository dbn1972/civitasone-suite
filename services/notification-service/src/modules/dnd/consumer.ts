import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { dndWindows } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerDndConsumers(q: Queue): void {
  q.subscribe<{
    id: string; tenantId: string; userId: string;
    startTime: string; endTime: string; timezone: string; days?: string[];
  }>(COMMANDS.setDndWindow, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      await tx.insert(dndWindows).values({
        id: p.id,
        tenantId: p.tenantId,
        userId: p.userId,
        startTime: p.startTime,
        endTime: p.endTime,
        timezone: p.timezone,
        days: p.days ?? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.dndWindowSet,
        eventType: EVENTS.dndWindowSet,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { windowId: p.id, userId: p.userId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "set_dnd_window", resourceType: "dnd_window", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dnd_windows", msg.payload.userId));
  });

  q.subscribe<{
    id: string; tenantId: string; startTime?: string; endTime?: string;
    timezone?: string; days?: string[]; enabled?: boolean;
  }>(COMMANDS.updateDndWindow, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      const { eq, and } = await import("drizzle-orm");
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.startTime !== undefined) set.startTime = p.startTime;
      if (p.endTime !== undefined) set.endTime = p.endTime;
      if (p.timezone !== undefined) set.timezone = p.timezone;
      if (p.days !== undefined) set.days = p.days;
      if (p.enabled !== undefined) set.enabled = p.enabled;

      await tx.update(dndWindows).set(set)
        .where(and(eq(dndWindows.id, p.id), eq(dndWindows.tenantId, p.tenantId)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_dnd_window", resourceType: "dnd_window", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dnd_windows", msg.payload.id));
  });
}

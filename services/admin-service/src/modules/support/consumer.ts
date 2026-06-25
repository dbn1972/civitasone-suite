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
      // P0: at most one OPEN grant per tenant. If another grant is already open
      // (a distinct ticket -> distinct messageId, so markProcessed did not catch
      // it), this open is a no-op rather than a second concurrent grant. The
      // partial-unique index is the hard backstop; this guard avoids surfacing
      // the violation as a poison message.
      const alreadyOpen = await repo.findOpenByTenant(tx, msg.payload.tenantId);
      if (alreadyOpen) return;
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
        // P1-2: surface the TTL so downstream consumers know when the grant lapses.
        payload: { breakGlassId: msg.payload.id, tenantId: msg.payload.tenantId, ticketId: msg.payload.ticketId, expiresAt: expiresAt.toISOString() },
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
      // P1-3: only close a still-open grant; a re-close is a no-op (no row, no event).
      const closed = await repo.closeBreakGlass(tx, msg.payload.id, msg.actorId, "manual");
      if (!closed) return;
      // P1-3: emit breakGlassClosed and audit under the GRANT's tenant, not the actor's.
      await enqueue(tx, {
        topic: EVENTS.breakGlassClosed, eventType: EVENTS.breakGlassClosed,
        tenantId: closed.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { breakGlassId: closed.id, tenantId: closed.tenantId, ticketId: closed.ticketId, reason: "manual" },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: closed.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "admin", action: "breakglass_close", resourceType: "break_glass", resourceId: closed.id, outcome: "success" },
      });
    });
  });
}

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000099";

/**
 * P1-2: close every break-glass grant whose TTL has lapsed. Each grant is closed
 * under its own tenant and emits a breakGlassClosed event labelled auto_expired
 * plus an audit record. Returns the number of grants swept.
 */
export async function sweepExpiredBreakGlass(now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await repo.findExpiredOpen(tx, now);
    let swept = 0;
    for (const grant of expired) {
      const closed = await repo.closeBreakGlass(tx, grant.id, SYSTEM_ACTOR, "auto_expired");
      if (!closed) continue;
      swept += 1;
      await enqueue(tx, {
        topic: EVENTS.breakGlassClosed, eventType: EVENTS.breakGlassClosed,
        tenantId: closed.tenantId, actorId: SYSTEM_ACTOR, correlationId: closed.correlationId,
        payload: { breakGlassId: closed.id, tenantId: closed.tenantId, ticketId: closed.ticketId, reason: "auto_expired" },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: closed.tenantId, actorId: SYSTEM_ACTOR, correlationId: closed.correlationId,
        payload: { service: "admin", action: "breakglass_auto_expire", resourceType: "break_glass", resourceId: closed.id, outcome: "success" },
      });
    }
    return swept;
  });
}

/** P1-2: start the periodic TTL sweeper. Returns the interval handle. */
export function startBreakGlassSweeper(intervalMs = 60_000): NodeJS.Timeout {
  const tick = (): void => {
    void sweepExpiredBreakGlass().catch(() => { /* logged by caller context */ });
  };
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

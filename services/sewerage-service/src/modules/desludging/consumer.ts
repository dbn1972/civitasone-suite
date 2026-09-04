import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { formatBookingNumber } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "sewerage.desludging.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerDesludgingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.desludgingBook, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextBookingNumber) —
      // replaces the old `SEWD-${Date.now()}` scheme.
      const bookingNumber = formatBookingNumber(await repo.nextBookingNumber(tx));
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, bookingNumber,
        requestedBy: p.requestedBy, address: p.address,
        tankCapacityLitres: p.tankCapacityLitres, requestedDate: p.requestedDate,
        requestedSlot: p.requestedSlot, status: "requested",
        // p.feeMinor is a canonical minor-unit string or null — `!= null`
        // (not truthy) so a deliberate fee of "0" doesn't collapse to null.
        feeMinor: p.feeMinor != null ? BigInt(p.feeMinor) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingBooked, eventType: EVENTS.desludgingBooked,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id, bookingNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.book", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging booked");
  });

  queue.subscribe(COMMANDS.desludgingSchedule, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "scheduled", vehicleId: p.vehicleId, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingScheduled, eventType: EVENTS.desludgingScheduled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id, vehicleId: p.vehicleId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.schedule", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging scheduled");
  });

  queue.subscribe(COMMANDS.desludgingDispatch, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "dispatched", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingDispatched, eventType: EVENTS.desludgingDispatched,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.dispatch", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging dispatched");
  });

  queue.subscribe(COMMANDS.desludgingComplete, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "completed", feePaid: true, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingCompleted, eventType: EVENTS.desludgingCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.complete", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging completed");
  });

  queue.subscribe(COMMANDS.desludgingCancel, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "cancelled", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingCancelled, eventType: EVENTS.desludgingCancelled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.cancel", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging cancelled");
  });
}

import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateBookingNumber } from "./domain.js";

const log = pino({ name: "parking.bookings.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBookingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createBooking, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      facilityId: string;
      vehicleNumber: string;
      vehicleType: string;
      spaceNumber?: string;
    };
    const bookingNumber = generateBookingNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBooking(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        bookingNumber,
        facilityId: p.facilityId,
        vehicleNumber: p.vehicleNumber,
        vehicleType: p.vehicleType,
        entryTime: null,
        exitTime: null,
        durationMinutes: null,
        amountMinor: null,
        currency: "INR",
        status: "booked",
        paymentRef: null,
        spaceNumber: p.spaceNumber ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.bookingCreated,
        eventType: EVENTS.bookingCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id, bookingNumber, vehicleNumber: p.vehicleNumber },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.create",
        resourceType: "parking_booking",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, bookingNumber }, "parking booking created");
  });

  queue.subscribe(COMMANDS.recordEntry, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; spaceNumber?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "active", msg.actorId, {
        entryTime: new Date(),
        spaceNumber: p.spaceNumber,
      });
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.entryRecorded,
        eventType: EVENTS.entryRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.entry",
        resourceType: "parking_booking",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.recordExit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; paymentRef?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const booking = await repo.findById(p.id, msg.tenantId);
      if (!booking?.entryTime) return;
      const exitTime = new Date();
      const durationMinutes = Math.round((exitTime.getTime() - booking.entryTime.getTime()) / 60000);
      // Placeholder: Rs 20/hr
      const amountMinor = BigInt(Math.ceil(durationMinutes / 60)) * 2000n;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", msg.actorId, {
        exitTime,
        durationMinutes,
        amountMinor,
        paymentRef: p.paymentRef,
      });
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.exitRecorded,
        eventType: EVENTS.exitRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id, durationMinutes, amountMinor: String(amountMinor) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.exit",
        resourceType: "parking_booking",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.cancelBooking, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.bookingCancelled,
        eventType: EVENTS.bookingCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.cancel",
        resourceType: "parking_booking",
        resourceId: p.id,
      });
    });
  });
}

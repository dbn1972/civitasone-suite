import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as facilitiesRepo from "../facilities/repo.js";
import { generateBookingNumber, calculateParkingFee, fromStatusesFor } from "./domain.js";

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
    // Mitigation: was `Date.now() % 999999` — a deterministic sequence repeating
    // every ~16.7 minutes, checked against a globally (not per-tenant) .unique()
    // column, colliding across ALL tenants and throwing inside this transaction
    // after the caller already got 202. crypto.randomInt makes collisions far
    // less likely without a schema change; a real fix needs a per-tenant DB
    // sequence (follow-up, not done here — same pattern recurs fleet-wide).
    const bookingNumber = generateBookingNumber("ULB", randomInt(1, 999999));

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
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // fromStatusesFor("active") = ["booked"] — previously this had no status
      // guard at all and could re-activate an already-completed/cancelled booking.
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "active", fromStatusesFor("active"), msg.actorId, {
        entryTime: new Date(),
        ...(p.spaceNumber !== undefined ? { spaceNumber: p.spaceNumber } : {}),
      });
      if (!updated) return;
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
    if (updated) await cache.put(`parking:${msg.tenantId}:booking:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.recordExit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; paymentRef?: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const booking = await repo.findById(p.id, msg.tenantId);
      // Was: `if (!booking?.entryTime) return;` only — catches "never entered"
      // but NOT "already exited": entryTime stays set after a first exit, so a
      // second recordExit on an already-completed booking would recompute
      // duration/amount from the same stale entryTime to *now* and re-bill,
      // re-emitting exitRecorded with a larger amount (a double-billing/replay
      // path independent of the tariff fix below). fromStatusesFor("completed")
      // = ["active"] in the atomic UPDATE guard below now closes that: a second
      // recordExit finds status is no longer "active" and updateStatus no-ops.
      if (!booking?.entryTime) return;
      const facility = await facilitiesRepo.findById(booking.facilityId, msg.tenantId);
      const exitTime = new Date();
      const durationMinutes = Math.round((exitTime.getTime() - booking.entryTime.getTime()) / 60000);
      // Was: hardcoded "Placeholder: Rs 20/hr" flat rate, ignoring the facility's
      // actual tariffPerHourMinor (already stored on parking_facilities and
      // already exposed by facilitiesRepo.findById) and the calculateParkingFee()
      // domain function that existed specifically for this purpose but was never
      // called. If the facility hasn't configured an hourly tariff, amountMinor
      // stays null (a real, nullable state — "not chargeable" — rather than
      // inventing a new fallback magic number) and this is logged for follow-up.
      let amountMinor: bigint | null = null;
      if (facility?.tariffPerHourMinor != null) {
        amountMinor = calculateParkingFee(durationMinutes, facility.tariffPerHourMinor);
      } else {
        log.warn({ bookingId: p.id, facilityId: booking.facilityId }, "no tariffPerHourMinor configured for facility; exiting without a fee");
      }
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", fromStatusesFor("completed"), msg.actorId, {
        exitTime,
        durationMinutes,
        ...(amountMinor !== null ? { amountMinor } : {}),
        ...(p.paymentRef !== undefined ? { paymentRef: p.paymentRef } : {}),
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.exitRecorded,
        eventType: EVENTS.exitRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id, durationMinutes, amountMinor: amountMinor !== null ? String(amountMinor) : null },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.exit",
        resourceType: "parking_booking",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`parking:${msg.tenantId}:booking:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.cancelBooking, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", fromStatusesFor("cancelled"), msg.actorId);
      if (!updated) return;
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
    if (updated) await cache.put(`parking:${msg.tenantId}:booking:${p.id}`, updated);
  });
}

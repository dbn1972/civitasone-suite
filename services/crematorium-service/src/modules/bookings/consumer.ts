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
import { generateBookingNumber, calculateFeeMinor, fromStatusesFor } from "./domain.js";

const log = pino({ name: "crematorium.bookings.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBookingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestBooking, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      facilityId: string;
      applicantName: string;
      applicantPhone: string;
      applicantRelation?: string;
      deceasedName: string;
      deceasedAge?: number;
      deceasedGender?: string;
      deathCertificateRef?: string;
      serviceType: string;
      requestedDate: string;
      requestedSlot?: string;
    };
    // Mitigation: was `Date.now() % 999999`, a deterministic sequence that repeats
    // every ~16.7 minutes and collides across ALL tenants (the column is globally
    // .unique(), not tenant-scoped) — any two bookings landing on the same modulo
    // value throw a unique-violation inside this transaction, after the caller
    // already got 202 Accepted. A cryptographically random 6-digit value make
    // collisions far less likely without a schema change; a real fix would replace
    // this with a per-tenant DB sequence (tracked as a follow-up, not done here).
    const bookingNumber = generateBookingNumber("ULB", randomInt(1, 999999));
    const feeMinor = calculateFeeMinor(p.serviceType);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBooking(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        bookingNumber,
        facilityId: p.facilityId,
        applicantName: p.applicantName,
        applicantPhone: p.applicantPhone,
        applicantRelation: p.applicantRelation ?? null,
        deceasedName: p.deceasedName,
        deceasedAge: p.deceasedAge ?? null,
        deceasedGender: p.deceasedGender ?? null,
        deathCertificateRef: p.deathCertificateRef ?? null,
        serviceType: p.serviceType,
        requestedDate: p.requestedDate,
        requestedSlot: p.requestedSlot ?? null,
        status: "requested",
        slotNumber: null,
        feeMinor,
        currency: "INR",
        feePaid: false,
        paymentRef: null,
        completedAt: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.bookingRequested,
        eventType: EVENTS.bookingRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id, bookingNumber, facilityId: p.facilityId, serviceType: p.serviceType },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.request",
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, bookingNumber }, "crematorium booking requested");
  });

  queue.subscribe(COMMANDS.confirmBooking, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; slotNumber: string; paymentRef?: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "confirmed", fromStatusesFor("confirmed"), msg.actorId, {
        slotNumber: p.slotNumber,
        ...(p.paymentRef !== undefined ? { paymentRef: p.paymentRef } : {}),
        feePaid: !!p.paymentRef,
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.bookingConfirmed,
        eventType: EVENTS.bookingConfirmed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id, slotNumber: p.slotNumber },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.confirm",
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    // Prime the read cache with the fresh row (outside the tx, read-your-writes) so
    // GET .../bookings/:id doesn't keep serving the pre-confirm row for up to the
    // cache's TTL. No cache.del()/invalidate exists on @civitasone/cache by design —
    // put() is the supported way to refresh an entry after a write.
    if (updated) await cache.put(`crematorium:${msg.tenantId}:booking:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.completeBooking, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", fromStatusesFor("completed"), msg.actorId, {
        completedAt: new Date(),
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.bookingCompleted,
        eventType: EVENTS.bookingCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bookingId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.complete",
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`crematorium:${msg.tenantId}:booking:${p.id}`, updated);
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
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`crematorium:${msg.tenantId}:booking:${p.id}`, updated);
  });
}

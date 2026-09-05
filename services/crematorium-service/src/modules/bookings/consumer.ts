import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
    const feeMinor = calculateFeeMinor(p.serviceType);
    let bookingNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Sequence number reserved inside this transaction (see
      // repo.nextBookingNumber) - replaces the old randomInt(1, 999999)
      // scheme, which was cryptographically random but not guaranteed
      // unique: a real birthday-paradox collision risk against
      // booking_number's UNIQUE constraint at moderate volume (any
      // collision would throw a unique-violation inside this transaction,
      // after the caller already received 202 Accepted). Mirrors
      // animal-service's nextComplaintNumber / vendor-service's
      // nextLicenceNumber (same fix shape, see migrations/
      // 0002_number_sequences.sql).
      bookingNumber = generateBookingNumber("ULB", await repo.nextBookingNumber(tx));
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
      // Fee challan: feeMinor is computed above by calculateFeeMinor(serviceType)
      // — a pure function of a closed 3-value enum with no client-supplied
      // amount anywhere in this command's payload (see cross-events.ts's file
      // header for why no ceiling/role-gate applies here). Fired in the same
      // transaction as the booking insert so a finance-side failure rolls the
      // booking back too, rather than leaving an unbilled booking on record.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: bookingNumber,
        depositor: p.applicantName,
        amountMinor: feeMinor,
      });
      // Citizen-meaningful: this command IS the booking request — the
      // applicant needs to know it was received, and bookingNumber/feeMinor
      // are both already in hand from this same transaction, so no pre-tx
      // recipient lookup is needed (unlike the admin-triggered transitions
      // below, whose command payloads carry only {id, ...}).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: p.applicantPhone,
        recipientId: p.id,
        variables: {
          bookingId: p.id,
          bookingNumber,
          applicantName: p.applicantName,
          serviceType: p.serviceType,
        },
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
    // Recipient-lookup read BEFORE opening the write transaction — this
    // command's payload carries only {id, slotNumber, paymentRef}, no
    // applicantPhone/bookingNumber. repo.findById opens its own scopedRead
    // transaction, so calling it from inside db.transaction below would nest
    // transactions on the same connection pool — the exact deadlock class
    // fixed in PR #1028 (notification-service's checkQuota/checkDlt nested
    // inside the outer send transaction).
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: the booking is now confirmed with a slot — the
      // applicant needs this before showing up at the facility.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.applicantPhone,
          recipientId: p.id,
          variables: {
            bookingId: p.id,
            bookingNumber: existing.bookingNumber,
            applicantName: existing.applicantName,
            status: "confirmed",
            slotNumber: p.slotNumber,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.confirm",
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    // Prime the read cache with the fresh row (outside the tx, read-your-writes) so
    // GET .../bookings/:id doesn't keep serving the pre-confirm row for up to the
    // cache's TTL. Correction: @civitasone/cache also exposes invalidate() /
    // invalidateAfterCommit() (packages/cache/src/index.ts), the more common
    // convention elsewhere in this monorepo (e.g. admin-service) -- an earlier
    // version of this comment incorrectly claimed no such method exists.
    // put() is used deliberately here instead, since the fresh row is already
    // in hand from .returning(), sparing the next GET a DB round-trip that a
    // plain invalidate() would otherwise force.
    if (updated) await cache.put(`crematorium:${msg.tenantId}:booking:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.completeBooking, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Recipient-lookup read BEFORE opening the write transaction — same
    // reasoning as confirmBooking above; this command's payload carries
    // only {id}.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: the service has been completed — the family's
      // final confirmation that the cremation/burial has taken place.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.applicantPhone,
          recipientId: p.id,
          variables: {
            bookingId: p.id,
            bookingNumber: existing.bookingNumber,
            applicantName: existing.applicantName,
            status: "completed",
          },
        });
      }
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
    // Recipient-lookup read BEFORE opening the write transaction — same
    // reasoning as confirmBooking/completeBooking above; this command's
    // payload carries only {id}.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: the booking was cancelled — the applicant (or
      // staff acting on their behalf) needs confirmation, most of all if
      // they didn't initiate the cancellation themselves.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.applicantPhone,
          recipientId: p.id,
          variables: {
            bookingId: p.id,
            bookingNumber: existing.bookingNumber,
            applicantName: existing.applicantName,
            status: "cancelled",
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "booking.cancel",
        resourceType: "crematorium_booking",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`crematorium:${msg.tenantId}:booking:${p.id}`, updated);
  });
}

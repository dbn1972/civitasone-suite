/**
 * Booking consumer — handles facility and booking workflow commands (HALL-001…005).
 *
 * Commands: createFacility, updateFacility, createBooking, submitBooking,
 *           approveBooking, recordPayment, cancelBooking, completeBooking.
 *
 * Idempotency via markProcessed. Audit on every state change.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { assertValidTransition, generateBookingNumber, calculateBookingAmount, calculateRefund } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { estabFacilitiesCatalog, estabBookings, estabBookingCalendar } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const log = pino({ name: "booking-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerBookingConsumers(rawQueue: Queue): void {
  // ── Create Facility ────────────────────────────────────────────────────
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.bookingFacilityCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; facilityName: string; facilityType: string;
        address?: unknown; ward?: string; capacity?: number; amenities?: unknown;
        photos?: unknown; ratePerHourMinor?: number; ratePerDayMinor?: number;
        currency?: string; securityDepositMinor?: number; operatingHours?: unknown;
        closedDays?: unknown; rules?: string; contactPerson?: string; contactPhone?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabFacilitiesCatalog).values({
          id: p.id, tenantId: p.tenantId, facilityName: p.facilityName,
          facilityType: p.facilityType, address: p.address ?? null,
          ward: p.ward ?? null, capacity: p.capacity ?? null,
          amenities: p.amenities ?? null, photos: p.photos ?? null,
          ratePerHourMinor: p.ratePerHourMinor != null ? BigInt(p.ratePerHourMinor) : null,
          ratePerDayMinor: p.ratePerDayMinor != null ? BigInt(p.ratePerDayMinor) : null,
          currency: p.currency ?? "INR",
          securityDepositMinor: p.securityDepositMinor != null ? BigInt(p.securityDepositMinor) : null,
          operatingHours: p.operatingHours ?? null, closedDays: p.closedDays ?? null,
          rules: p.rules ?? null, contactPerson: p.contactPerson ?? null,
          contactPhone: p.contactPhone ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "facility_created", "facility", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingFacilityCreate failed"); }
  });

  // ── Update Facility ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingFacilityUpdate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; [k: string]: unknown };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const { id, tenantId, ...updates } = p;
        const setClause: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
        for (const [k, v] of Object.entries(updates)) {
          if (k === "ratePerHourMinor" || k === "ratePerDayMinor" || k === "securityDepositMinor") {
            setClause[k] = v != null ? BigInt(v as number) : null;
          } else {
            setClause[k] = v;
          }
        }
        await tx.update(estabFacilitiesCatalog).set(setClause)
          .where(and(eq(estabFacilitiesCatalog.id, id), eq(estabFacilitiesCatalog.tenantId, tenantId)));
        await audit(tx, msg, "facility_updated", "facility", id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingFacilityUpdate failed"); }
  });

  // ── Create Booking ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; facilityId: string;
        applicantName: string; applicantPhone: string; applicantEmail?: string;
        purpose?: string; eventType?: string; eventDate: string;
        startTime: string; endTime: string; durationHours?: number;
        guestCount?: number; requirements?: unknown;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Look up facility for rate calculation
        const facRows = await tx.select().from(estabFacilitiesCatalog)
          .where(and(eq(estabFacilitiesCatalog.id, p.facilityId), eq(estabFacilitiesCatalog.tenantId, p.tenantId)))
          .limit(1);
        const facility = facRows[0];
        if (!facility) throw new Error("FACILITY_NOT_FOUND");

        const hours = p.durationHours ?? Math.max(1, Math.ceil(
          (parseTime(p.endTime) - parseTime(p.startTime)) / 60,
        ));
        const rate = facility.ratePerHourMinor ?? 0n;
        const deposit = facility.securityDepositMinor ?? 0n;
        const { amountMinor, securityDepositMinor, totalMinor } = calculateBookingAmount(rate, hours, deposit);
        const bookingNumber = generateBookingNumber();

        await tx.insert(estabBookings).values({
          id: p.id, tenantId: p.tenantId, bookingNumber, facilityId: p.facilityId,
          applicantName: p.applicantName, applicantPhone: p.applicantPhone,
          applicantEmail: p.applicantEmail ?? null, purpose: p.purpose ?? null,
          eventType: p.eventType ?? "other", eventDate: p.eventDate,
          startTime: p.startTime, endTime: p.endTime, durationHours: hours,
          guestCount: p.guestCount ?? null, requirements: p.requirements ?? null,
          status: "draft", amountMinor, securityDepositMinor, totalMinor,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "booking_created", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingCreate failed"); }
  });

  // ── Submit Booking ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingSubmit, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabBookings)
          .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
        const booking = rows[0];
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        assertValidTransition(booking.status, "submitted");
        await tx.update(estabBookings)
          .set({ status: "submitted", updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabBookings.version} + 1` })
          .where(eq(estabBookings.id, p.id));
        await audit(tx, msg, "booking_submitted", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingSubmit failed"); }
  });

  // ── Approve Booking ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabBookings)
          .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
        const booking = rows[0];
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        assertValidTransition(booking.status, "payment_pending");

        await tx.update(estabBookings)
          .set({
            status: "payment_pending", approvedBy: msg.actorId, approvedAt: new Date(),
            updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabBookings.version} + 1`,
          })
          .where(eq(estabBookings.id, p.id));

        // Block the calendar slot
        await tx.insert(estabBookingCalendar).values({
          tenantId: p.tenantId, facilityId: booking.facilityId,
          bookingDate: booking.eventDate, slotStart: booking.startTime, slotEnd: booking.endTime,
          bookingId: p.id, isBlocked: false,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: "estab.booking.approved", eventType: "estab.booking.approved",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { bookingId: p.id, facilityId: booking.facilityId, eventDate: booking.eventDate },
        });
        await audit(tx, msg, "booking_approved", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingApprove failed"); }
  });

  // ── Record Payment ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingRecordPayment, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; paymentRef?: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabBookings)
          .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
        const booking = rows[0];
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        assertValidTransition(booking.status, "confirmed");

        await tx.update(estabBookings)
          .set({
            status: "confirmed", paymentRef: p.paymentRef ?? null, paidAt: new Date(),
            updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabBookings.version} + 1`,
          })
          .where(eq(estabBookings.id, p.id));
        await audit(tx, msg, "booking_payment_recorded", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingRecordPayment failed"); }
  });

  // ── Cancel Booking ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingCancel, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; cancellationReason?: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabBookings)
          .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
        const booking = rows[0];
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        assertValidTransition(booking.status, "cancelled");

        const refundAmount = (booking.amountMinor != null && booking.securityDepositMinor != null)
          ? calculateRefund(new Date(booking.eventDate), new Date(), booking.amountMinor, booking.securityDepositMinor)
          : 0n;

        await tx.update(estabBookings)
          .set({
            status: "cancelled", cancellationReason: p.cancellationReason ?? null,
            cancelledAt: new Date(), refundAmountMinor: refundAmount,
            updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabBookings.version} + 1`,
          })
          .where(eq(estabBookings.id, p.id));

        // Remove calendar slot
        await tx.delete(estabBookingCalendar)
          .where(and(eq(estabBookingCalendar.bookingId, p.id), eq(estabBookingCalendar.tenantId, p.tenantId)));

        await enqueue(tx, {
          topic: "estab.booking.cancelled", eventType: "estab.booking.cancelled",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { bookingId: p.id, refundAmountMinor: refundAmount.toString() },
        });
        await audit(tx, msg, "booking_cancelled", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingCancel failed"); }
  });

  // ── Complete Booking ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingComplete, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabBookings)
          .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
        const booking = rows[0];
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        assertValidTransition(booking.status, "completed");

        await tx.update(estabBookings)
          .set({ status: "completed", updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabBookings.version} + 1` })
          .where(eq(estabBookings.id, p.id));

        await enqueue(tx, {
          topic: "estab.booking.completed", eventType: "estab.booking.completed",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { bookingId: p.id, facilityId: booking.facilityId },
        });
        await audit(tx, msg, "booking_completed", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingComplete failed"); }
  });
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}

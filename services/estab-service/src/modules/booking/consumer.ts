/**
 * Booking consumer — facility booking workflow (BRD 5.22 HALL-001…005).
 *
 * GAP2-ESTAB-BOOKING-ORPHAN-01: the booking routes shipped but had no consumer,
 * so every command was published to a topic nobody subscribed — the write never
 * landed. This consumer applies the CQRS writes (command → DB + outbox audit),
 * is idempotent (markProcessed), and audits every mutation in the same tx.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  assertValidTransition, generateBookingNumber, calculateBookingAmount, DomainError,
} from "./domain.js";
import { estabFacilitiesCatalog, estabBookings } from "./schema.js";

const log = pino({ name: "booking-consumer" });
const AUDIT_TOPIC = "audit.event.record";

type Msg = {
  messageId: string; tenantId: string; actorId: string; correlationId: string;
  payload: Record<string, unknown>;
};

export function registerBookingConsumers(queue: Queue): void {
  // ── Create facility ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingFacilityCreate, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabFacilitiesCatalog).values({
          id: p.id, tenantId: p.tenantId,
          facilityName: String(p.facilityName), facilityType: String(p.facilityType),
          address: (p.address as object | undefined) ?? null,
          ward: (p.ward as string | undefined) ?? null,
          capacity: (p.capacity as number | undefined) ?? null,
          amenities: (p.amenities as object | undefined) ?? null,
          photos: (p.photos as object | undefined) ?? null,
          ratePerHourMinor: p.ratePerHourMinor != null ? BigInt(p.ratePerHourMinor as number) : null,
          ratePerDayMinor: p.ratePerDayMinor != null ? BigInt(p.ratePerDayMinor as number) : null,
          currency: (p.currency as string | undefined) ?? "INR",
          securityDepositMinor: p.securityDepositMinor != null ? BigInt(p.securityDepositMinor as number) : null,
          operatingHours: (p.operatingHours as object | undefined) ?? null,
          closedDays: (p.closedDays as object | undefined) ?? null,
          rules: (p.rules as string | undefined) ?? null,
          contactPerson: (p.contactPerson as string | undefined) ?? null,
          contactPhone: (p.contactPhone as string | undefined) ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "facility_created", "booking_facility", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingFacilityCreate failed"); }
  });

  // ── Update facility ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bookingFacilityUpdate, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
        if (p.facilityName != null) set.facilityName = String(p.facilityName);
        if (p.facilityType != null) set.facilityType = String(p.facilityType);
        if (p.ratePerHourMinor != null) set.ratePerHourMinor = BigInt(p.ratePerHourMinor as number);
        if (p.ratePerDayMinor != null) set.ratePerDayMinor = BigInt(p.ratePerDayMinor as number);
        if (p.securityDepositMinor != null) set.securityDepositMinor = BigInt(p.securityDepositMinor as number);
        if (p.status != null) set.status = String(p.status);
        if (p.capacity != null) set.capacity = p.capacity;
        set.version = sql`${estabFacilitiesCatalog.version} + 1`;
        await tx.update(estabFacilitiesCatalog).set(set)
          .where(and(eq(estabFacilitiesCatalog.id, p.id), eq(estabFacilitiesCatalog.tenantId, p.tenantId)));
        await audit(tx, msg, "facility_updated", "booking_facility", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingFacilityUpdate failed"); }
  });

  // ── Create booking (draft) — computes amount from the facility rate ──────
  queue.subscribe(COMMANDS.bookingCreate, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; facilityId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const facRows = await tx.select().from(estabFacilitiesCatalog)
          .where(and(eq(estabFacilitiesCatalog.id, p.facilityId), eq(estabFacilitiesCatalog.tenantId, p.tenantId))).limit(1);
        const facility = facRows[0];
        if (!facility) throw new DomainError("FACILITY_NOT_FOUND", "facility not found");
        const durationHours = Number(p.durationHours ?? 0);
        const ratePerHour = facility.ratePerHourMinor ?? 0n;
        const deposit = facility.securityDepositMinor ?? 0n;
        const { amountMinor, securityDepositMinor, totalMinor } =
          calculateBookingAmount(ratePerHour, durationHours, deposit);
        await tx.insert(estabBookings).values({
          id: p.id, tenantId: p.tenantId, bookingNumber: generateBookingNumber(),
          facilityId: p.facilityId, applicantName: String(p.applicantName),
          applicantPhone: String(p.applicantPhone),
          applicantEmail: (p.applicantEmail as string | undefined) ?? null,
          purpose: (p.purpose as string | undefined) ?? null,
          eventType: (p.eventType as string | undefined) ?? "other",
          eventDate: String(p.eventDate), startTime: String(p.startTime), endTime: String(p.endTime),
          durationHours: durationHours || null,
          guestCount: (p.guestCount as number | undefined) ?? null,
          requirements: (p.requirements as object | undefined) ?? null,
          status: "draft",
          amountMinor, securityDepositMinor, totalMinor, currency: facility.currency,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "booking_created", "booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "bookingCreate failed"); }
  });

  // ── Lifecycle transitions ────────────────────────────────────────────────
  const transition = (
    topic: string, target: string, action: string,
    extra?: (p: Record<string, unknown>, actorId: string) => Record<string, unknown>,
  ) =>
    queue.subscribe(topic, async (msg: Msg) => {
      try {
        const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const rows = await tx.select().from(estabBookings)
            .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId))).limit(1);
          const booking = rows[0];
          if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "booking not found");
          assertValidTransition(booking.status, target);
          const set: Record<string, unknown> = {
            status: target, updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${estabBookings.version} + 1`,
            ...(extra ? extra(p, msg.actorId) : {}),
          };
          await tx.update(estabBookings).set(set)
            .where(and(eq(estabBookings.id, p.id), eq(estabBookings.tenantId, p.tenantId)));
          await audit(tx, msg, action, "booking", p.id);
        });
      } catch (err) { log.error({ err, messageId: msg.messageId }, `${topic} failed`); }
    });

  transition(COMMANDS.bookingSubmit, "submitted", "booking_submitted");
  transition(COMMANDS.bookingApprove, "approved", "booking_approved",
    (_p, actorId) => ({ approvedBy: actorId, approvedAt: new Date() }));
  transition(COMMANDS.bookingRecordPayment, "confirmed", "booking_payment_recorded",
    (p) => ({ paymentRef: (p.paymentRef as string | undefined) ?? null, paidAt: new Date() }));
  transition(COMMANDS.bookingCancel, "cancelled", "booking_cancelled",
    (p) => ({ cancellationReason: (p.cancellationReason as string | undefined) ?? null, cancelledAt: new Date() }));
  transition(COMMANDS.bookingComplete, "completed", "booking_completed");
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  msg: Msg, action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}

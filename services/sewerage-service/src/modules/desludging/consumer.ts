import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
      // p.feeMinor is a canonical minor-unit string or null — `!= null`
      // (not truthy) so a deliberate fee of "0" doesn't collapse to null.
      const feeMinor = p.feeMinor != null ? BigInt(p.feeMinor) : null;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, bookingNumber,
        requestedBy: p.requestedBy, address: p.address,
        tankCapacityLitres: p.tankCapacityLitres, requestedDate: p.requestedDate,
        requestedSlot: p.requestedSlot, status: "requested",
        feeMinor,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.desludgingBooked, eventType: EVENTS.desludgingBooked,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bookingId: p.id, bookingNumber },
      });
      // Fee (when quoted at booking time — desludging/routes.ts's optional
      // feeMinor) becomes due here, the point at which it is actually
      // assessed; completion just marks it feePaid, it never re-assesses an
      // amount. emitMunicipalFeeChallan no-ops for a null/nonpositive
      // amount and enforces its own bounds ceiling.
      if (feeMinor !== null) {
        await emitMunicipalFeeChallan(tx, ctxOf(msg), {
          sourceRef: bookingNumber,
          depositor: bookingNumber,
          amountMinor: feeMinor,
        });
      }
      // Citizen-meaningful: this command IS the submission (no separate
      // draft->submit step here, same as connections/consumer.ts's
      // connectionApply), and the actor is the citizen themselves
      // (desludging/commands.ts's bookDesludging publishes with
      // requestedBy: ctx.actorId === msg.actorId) — no pre-tx lookup needed.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: bookingNumber,
        recipientId: p.id,
        variables: { bookingId: p.id, bookingNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "desludging.book", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging booked");
  });

  queue.subscribe(COMMANDS.desludgingSchedule, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction —
    // bookingNumber isn't in this command's payload ({id, vehicleId,
    // version}). See connections/consumer.ts's connectionUpdateStatus for
    // the full nested-transaction-deadlock rationale (PR #1028).
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: the citizen now knows a vehicle/slot is
      // confirmed for their request.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.bookingNumber,
          recipientId: p.id,
          variables: { bookingId: p.id, bookingNumber: existing.bookingNumber, status: "scheduled", vehicleId: p.vehicleId },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "desludging.schedule", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging scheduled");
  });

  queue.subscribe(COMMANDS.desludgingDispatch, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // rationale as desludgingSchedule above.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: the vehicle is now actually en route to the
      // citizen's address — genuinely useful, real-time information, not an
      // internal-only status flip. Worth including even though it wasn't in
      // the original enumerated list, per tonight's reasoning discipline
      // (some services' "internal" exclusions were wrong).
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.bookingNumber,
          recipientId: p.id,
          variables: { bookingId: p.id, bookingNumber: existing.bookingNumber, status: "dispatched" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "desludging.dispatch", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging dispatched");
  });

  queue.subscribe(COMMANDS.desludgingComplete, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // rationale as desludgingSchedule above.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: service completed.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.bookingNumber,
          recipientId: p.id,
          variables: { bookingId: p.id, bookingNumber: existing.bookingNumber, status: "completed" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "desludging.complete", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging completed");
  });

  queue.subscribe(COMMANDS.desludgingCancel, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // rationale as desludgingSchedule above.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: a citizen who requested this (ROLES, not just
      // ADMIN_ROLES, may call desludging/routes.ts's cancel endpoint) or an
      // admin who cancelled it on the citizen's behalf both leave the
      // citizen needing to know their booking no longer stands — omitting
      // this would be exactly the kind of wrongly-internal exclusion called
      // out tonight.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.bookingNumber,
          recipientId: p.id,
          variables: { bookingId: p.id, bookingNumber: existing.bookingNumber, status: "cancelled" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "desludging.cancel", resourceType: "sewerage_desludging_booking", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "desludging cancelled");
  });
}

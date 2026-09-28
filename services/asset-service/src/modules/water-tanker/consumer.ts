/**
 * Water-tanker consumer — CQRS write path for the water-tanker asset
 * module (tanker bookings).
 *
 * Before this: water-tanker/routes.ts published commands
 * (asset.water_tanker.booking.*) with no consumer.ts ever registered in
 * worker.ts, and no migration ever created the `water_tanker` schema/table
 * (see migrations/0029_water_tanker_tables.sql). POST returned 202
 * {id,status:"accepted"} but nothing was ever persisted; GET list/by-id hit
 * "relation ... does not exist" (500) or came back silently empty despite
 * the "accepted" write.
 *
 * Scope: implements the full command surface routes.ts already exposes
 * (create, schedule, dispatch, deliver, cancel), since repo.ts already had
 * every insert/update function written and unused -- wiring them up is
 * mechanical, not new design. Status-mutation commands apply the target
 * status implied by the command name directly and do NOT re-validate
 * domain.ts's VALID_TRANSITIONS graph (e.g. delivering a booking that was
 * never dispatched currently succeeds). Deliberate, documented scope cut
 * per "core create+list+get-by-id over complex status transitions", not a
 * silent drop.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateBookingNumber, calculateTankerFee } from "./domain.js";

const log = pino({ name: "water-tanker-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const WATER_TANKER_BOOKING_CREATED = "asset.water_tanker.booking.created";

export function registerWaterTankerConsumers(rawQueue: Queue): void {
  // #146 regression fix pattern: run every handler inside the message tenant
  // context so NOBYPASSRLS + FORCE RLS accepts consumer writes.
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.waterTankerBookingCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; deliveryAddress?: Record<string, unknown>;
        ward?: string; tankerCapacityLitres: number; requestedDate: string; requestedSlot?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertBooking(tx, {
          id: p.id, tenantId: p.tenantId, bookingNumber: generateBookingNumber(),
          requestedBy: msg.actorId, deliveryAddress: p.deliveryAddress ?? null,
          ward: p.ward ?? null, tankerCapacityLitres: p.tankerCapacityLitres,
          requestedDate: p.requestedDate, requestedSlot: p.requestedSlot ?? null,
          feeMinor: calculateTankerFee(p.tankerCapacityLitres),
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_TANKER_BOOKING_CREATED, eventType: WATER_TANKER_BOOKING_CREATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { bookingId: p.id },
        });
        await audit(tx, msg, "create", "water_tanker_booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterTankerBookingCreate failed"); }
  });

  queue.subscribe(COMMANDS.waterTankerBookingSchedule, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; scheduledDate: string; tankerVehicleId?: string; driverId?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "scheduled", {
          scheduledDate: p.scheduledDate, tankerVehicleId: p.tankerVehicleId ?? null,
          driverId: p.driverId ?? null, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "schedule", "water_tanker_booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterTankerBookingSchedule failed"); }
  });

  queue.subscribe(COMMANDS.waterTankerBookingDispatch, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "dispatched", {
          dispatchedAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "dispatch", "water_tanker_booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterTankerBookingDispatch failed"); }
  });

  queue.subscribe(COMMANDS.waterTankerBookingDeliver, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "delivered", {
          deliveredAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "deliver", "water_tanker_booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterTankerBookingDeliver failed"); }
  });

  queue.subscribe(COMMANDS.waterTankerBookingCancel, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "cancelled", { updatedBy: msg.actorId });
        await audit(tx, msg, "cancel", "water_tanker_booking", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterTankerBookingCancel failed"); }
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}

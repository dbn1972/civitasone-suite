import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateBookingNumber, calculateTankerFee, assertTransition } from "./domain.js";

const log = pino({ name: "asset-water-tanker-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerWaterTankerConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.waterTankerBookingCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; deliveryAddress?: unknown; ward?: string;
        tankerCapacityLitres: number; requestedDate: string; requestedSlot?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const feeMinor = calculateTankerFee(p.tankerCapacityLitres);
        await repo.insertBooking(tx, {
          id: p.id, tenantId: p.tenantId, bookingNumber: generateBookingNumber(),
          requestedBy: msg.actorId, deliveryAddress: p.deliveryAddress ?? null,
          ward: p.ward ?? null, tankerCapacityLitres: p.tankerCapacityLitres,
          requestedDate: p.requestedDate, requestedSlot: p.requestedSlot ?? null,
          status: "requested", scheduledDate: null, tankerVehicleId: null,
          driverId: null, dispatchedAt: null, deliveredAt: null,
          feeMinor, currency: "INR", feePaid: false,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "water_tanker_booking", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterTankerBookingSchedule, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; scheduledDate: string;
        tankerVehicleId?: string; driverId?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        assertTransition("requested", "scheduled");
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "scheduled", {
          scheduledDate: p.scheduledDate,
          tankerVehicleId: p.tankerVehicleId ?? null,
          driverId: p.driverId ?? null,
          updatedBy: msg.actorId,
        });
        await audit(tx, msg, "schedule", "water_tanker_booking", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterTankerBookingDispatch, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        assertTransition("scheduled", "dispatched");
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "dispatched", {
          dispatchedAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "dispatch", "water_tanker_booking", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterTankerBookingDeliver, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        assertTransition("dispatched", "delivered");
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "delivered", {
          deliveredAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "deliver", "water_tanker_booking", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterTankerBookingCancel, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateBookingStatus(tx, p.id, p.tenantId, "cancelled", { updatedBy: msg.actorId });
        await audit(tx, msg, "cancel", "water_tanker_booking", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}

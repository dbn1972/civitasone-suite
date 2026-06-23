import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { checkNoOverlap } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const ASSET_CREATE = "asset.asset.create";
const VEHICLE_CATEGORY = "77777777-0001-0000-0000-000000000002";

export function registerAssetsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.vehicleCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; regNo: string; makeModel: string; fuelType: string; allocatedTo?: string };
    const assetId = randomUUID();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertVehicle(tx, {
        id: p.id, tenantId: p.tenantId, regNo: p.regNo, makeModel: p.makeModel,
        fuelType: p.fuelType, allocatedTo: p.allocatedTo ?? null,
        odometerKm: 0, status: "available",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: ASSET_CREATE, eventType: ASSET_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: assetId,
          tenantId: p.tenantId,
          name: `${p.makeModel} (${p.regNo})`,
          code: p.regNo,
          categoryId: VEHICLE_CATEGORY,
          assetType: "vehicle",
          acquisitionCost: 0,
          acquisitionDate: new Date().toISOString().slice(0, 10),
          location: p.allocatedTo ?? null,
          notes: `estab_vehicle:${p.id}`,
          barcode: `VEH-${p.regNo.replace(/\s/g, "-")}`,
        },
      });
      await audit(tx, msg, "create", "vehicle", p.id);
    });
  });

  queue.subscribe(COMMANDS.vehicleBook, async (msg) => {
    const p = msg.payload as { id: string; vehicleId: string; tenantId: string; requestedBy: string; driverId?: string; purpose: string; fromDt: string; toDt: string };
    const existing = await repo.findBookingsByVehicle(p.vehicleId);
    const fromDt = new Date(p.fromDt);
    const toDt   = new Date(p.toDt);

    try {
      checkNoOverlap(existing, fromDt, toDt);
    } catch {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.vehicleConflict, eventType: EVENTS.vehicleConflict,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { vehicleId: p.vehicleId, requestedBy: p.requestedBy, fromDt: p.fromDt, toDt: p.toDt },
        });
      });
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBooking(tx, {
        id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId,
        requestedBy: p.requestedBy, driverId: p.driverId ?? null,
        purpose: p.purpose, fromDt, toDt, status: "approved",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "book", "vehicle_booking", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vehicle", p.vehicleId));
  });

  queue.subscribe(COMMANDS.vehicleReturn, async (msg) => {
    const p = msg.payload as { bookingId: string; tenantId: string; odometerKm?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateBooking(tx, p.bookingId, { status: "returned", updatedBy: msg.actorId });
      const booking = await repo.findBookingById(p.bookingId);
      if (booking && p.odometerKm != null) {
        await repo.updateVehicle(tx, booking.vehicleId, { odometerKm: p.odometerKm, status: "available", updatedBy: msg.actorId });
      }
      await audit(tx, msg, "return", "vehicle_booking", p.bookingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vehicle_booking", p.bookingId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}

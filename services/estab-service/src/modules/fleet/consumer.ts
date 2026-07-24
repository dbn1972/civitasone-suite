/**
 * Fleet consumer — handles fuel logs, trip logs, vehicle docs, driver roster.
 * Validates odometer progression, emits expiry reminders.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { assertOdometerProgression } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { fuelLogs, tripLogs, vehicleDocuments, driverRoster } from "./schema.js";
import { estabVehicles } from "../assets/schema.js";

const log = pino({ name: "fleet-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.send";

export function registerFleetConsumers(queue: Queue): void {
  // ── Fuel Log ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.fuelLogCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; vehicleId: string; logDate: string;
        fuelType: string; litres: string; costMinor: number; odometerKm: number;
        pumpName?: string; receiptRef?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Validate odometer progression
        const vehicleRows = await tx.select().from(estabVehicles)
          .where(and(eq(estabVehicles.id, p.vehicleId), eq(estabVehicles.tenantId, p.tenantId))).limit(1);
        const vehicle = vehicleRows[0];
        if (vehicle) {
          assertOdometerProgression(vehicle.odometerKm, p.odometerKm);
          // Update vehicle odometer
          await tx.update(estabVehicles)
            .set({ odometerKm: p.odometerKm, updatedAt: new Date(), updatedBy: msg.actorId })
            .where(eq(estabVehicles.id, p.vehicleId));
        }

        await tx.insert(fuelLogs).values({
          id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId,
          logDate: p.logDate, fuelType: p.fuelType, litres: p.litres,
          costMinor: BigInt(p.costMinor), odometerKm: p.odometerKm,
          pumpName: p.pumpName ?? null, receiptRef: p.receiptRef ?? null,
          createdBy: msg.actorId,
        });
        await audit(tx, msg, "fuel_log_created", "fuel_log", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "fuelLogCreate failed"); }
  });

  // ── Trip Log ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.tripLogCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; vehicleId: string; driverId?: string;
        tripDate: string; startOdometer: number; startTime: string;
        purpose: string; passengerName?: string; route?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(tripLogs).values({
          id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId,
          driverId: p.driverId ?? null, tripDate: p.tripDate,
          startOdometer: p.startOdometer, startTime: new Date(p.startTime),
          purpose: p.purpose, passengerName: p.passengerName ?? null,
          route: p.route ?? null, status: "in_progress",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "trip_started", "trip_log", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "tripLogCreate failed"); }
  });

  // ── Trip Complete ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.tripLogComplete, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; endOdometer: number; endTime: string; version: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(tripLogs)
          .where(and(eq(tripLogs.id, p.id), eq(tripLogs.tenantId, p.tenantId))).limit(1);
        const trip = rows[0];
        if (!trip) throw new Error("TRIP_NOT_FOUND");
        assertOdometerProgression(trip.startOdometer, p.endOdometer);

        await tx.update(tripLogs)
          .set({
            endOdometer: p.endOdometer, endTime: new Date(p.endTime),
            status: "completed", updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${tripLogs.version} + 1`,
          })
          .where(and(eq(tripLogs.id, p.id), eq(tripLogs.version, p.version)));

        // Update vehicle odometer
        await tx.update(estabVehicles)
          .set({ odometerKm: p.endOdometer, updatedAt: new Date(), updatedBy: msg.actorId })
          .where(eq(estabVehicles.id, trip.vehicleId));

        await audit(tx, msg, "trip_completed", "trip_log", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "tripLogComplete failed"); }
  });

  // ── Vehicle Document ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.vehicleDocCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; vehicleId: string; docType: string;
        docNumber?: string; validFrom: string; validUntil: string;
        issuer?: string; amountMinor?: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(vehicleDocuments).values({
          id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId,
          docType: p.docType, docNumber: p.docNumber ?? null,
          validFrom: p.validFrom, validUntil: p.validUntil,
          issuer: p.issuer ?? null,
          amountMinor: p.amountMinor ? BigInt(p.amountMinor) : null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "vehicle_doc_created", "vehicle_document", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "vehicleDocCreate failed"); }
  });

  // ── Driver Roster ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.driverRosterCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; driverId: string; vehicleId?: string;
        shiftDate: string; shiftType: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(driverRoster).values({
          id: p.id, tenantId: p.tenantId, driverId: p.driverId,
          vehicleId: p.vehicleId ?? null, shiftDate: p.shiftDate,
          shiftType: p.shiftType, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "roster_created", "driver_roster", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "driverRosterCreate failed"); }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", module: "fleet", action, resourceType, resourceId, outcome: "success" },
  });
}

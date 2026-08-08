/**
 * visitor-service: vehicle-pass consumer.
 *
 * Handles `COMMANDS.vehiclePassCreate` and `COMMANDS.parkingSlotRelease`:
 *
 * vehiclePassCreate:
 *   markProcessed(tx, msg.messageId) → load candidate parking slots for the
 *   location → call `allocateParkingSlotOrThrow` from domain.ts → mark slot
 *   occupied in `parking_slots` → insert `vehicle_passes` row with the
 *   allocated `parking_slot_id`.
 *
 * parkingSlotRelease:
 *   markProcessed(tx, msg.messageId) → load the parking slot → call
 *   `releaseParkingSlot` from domain.ts → mark slot available in
 *   `parking_slots` → update `vehicle_passes` status to "checked_out".
 *
 * Follows the CQRS consumer pattern from modules/blacklist/consumer.ts.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { vehiclePasses } from "./schema.js";
import { parkingSlots } from "../location/schema.js";
import {
  allocateParkingSlotOrThrow,
  releaseParkingSlot,
  type VehicleType,
  type VisitorCategory,
  type ParkingSlotCandidate,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "vehicle-pass-consumer" });

// ── Payload Types ────────────────────────────────────────────────────────

interface VehiclePassCreatePayload {
  id: string;
  tenantId: string;
  passId: string;
  locationId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  visitorCategory: VisitorCategory;
  driverName: string | null;
}

interface ParkingSlotReleasePayload {
  vehiclePassId: string;
  parkingSlotId: string;
  tenantId: string;
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerVehiclePassConsumers(queue: Queue): void {
  // ─── vehiclePassCreate ─────────────────────────────────────────────────
  queue.subscribe<VehiclePassCreatePayload>(COMMANDS.vehiclePassCreate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Load candidate slots for this location (ordered by slot_number for
      // stable, predictable allocation — per domain.ts JSDoc).
      const candidateRows = await tx
        .select()
        .from(parkingSlots)
        .where(
          and(
            eq(parkingSlots.locationId, p.locationId),
            eq(parkingSlots.tenantId, msg.tenantId),
          ),
        );

      // Project DB rows to domain ParkingSlotCandidate shape.
      const candidates: ParkingSlotCandidate[] = candidateRows.map((r) => ({
        id: r.id,
        category: r.category as ParkingSlotCandidate["category"],
        vehicleType: r.vehicleType as VehicleType,
        occupied: r.occupied,
        occupiedBy: r.occupiedBy,
      }));

      // Domain allocation — throws PARKING_UNAVAILABLE (422) if no slot available.
      const allocated = allocateParkingSlotOrThrow(candidates, p.vehicleType, p.visitorCategory);

      // Mark slot occupied in DB.
      await tx
        .update(parkingSlots)
        .set({
          occupied: true,
          occupiedBy: p.id,
          updatedAt: new Date(),
        })
        .where(eq(parkingSlots.id, allocated.id));

      // Insert vehicle_passes row.
      await tx.insert(vehiclePasses).values({
        id: p.id,
        tenantId: msg.tenantId,
        passId: p.passId,
        locationId: p.locationId,
        registrationNumber: p.registrationNumber,
        vehicleType: p.vehicleType,
        driverName: p.driverName,
        parkingSlotId: allocated.id,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "vehicle_pass", resourceId: p.locationId, outcome: "success" } });
    });

    log.info(
      { tenantId: msg.tenantId, passId: p.passId, vehiclePassId: p.id },
      "vehicle pass created with parking slot allocated",
    );
  });

  // ─── parkingSlotRelease ────────────────────────────────────────────────
  queue.subscribe<ParkingSlotReleasePayload>(COMMANDS.parkingSlotRelease, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Load the parking slot to release.
      const slotRows = await tx
        .select()
        .from(parkingSlots)
        .where(
          and(
            eq(parkingSlots.id, p.parkingSlotId),
            eq(parkingSlots.tenantId, msg.tenantId),
          ),
        )
        .limit(1);

      const slotRow = slotRows[0];
      if (!slotRow) {
        log.warn(
          { tenantId: msg.tenantId, parkingSlotId: p.parkingSlotId },
          "parking slot not found for release; skipping",
        );
        return;
      }

      // Project to domain shape and validate release.
      const slotCandidate: ParkingSlotCandidate = {
        id: slotRow.id,
        category: slotRow.category as ParkingSlotCandidate["category"],
        vehicleType: slotRow.vehicleType as VehicleType,
        occupied: slotRow.occupied,
        occupiedBy: slotRow.occupiedBy,
      };

      const released = releaseParkingSlot(slotCandidate);

      // Mark slot available in DB.
      await tx
        .update(parkingSlots)
        .set({
          occupied: released.occupied,
          occupiedBy: released.occupiedBy,
          updatedAt: new Date(),
        })
        .where(eq(parkingSlots.id, p.parkingSlotId));

      // Update vehicle pass status to checked_out.
      await tx
        .update(vehiclePasses)
        .set({
          status: "checked_out",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        })
        .where(
          and(
            eq(vehiclePasses.id, p.vehiclePassId),
            eq(vehiclePasses.tenantId, msg.tenantId),
          ),
        );
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "vehicle_pass", resourceId: p.parkingSlotId, outcome: "success" } });
    });

    log.info(
      { tenantId: msg.tenantId, vehiclePassId: p.vehiclePassId, slotId: p.parkingSlotId },
      "parking slot released",
    );
  });
}

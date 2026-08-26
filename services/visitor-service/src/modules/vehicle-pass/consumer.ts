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
  DomainError,
  type VehicleType,
  type VisitorCategory,
  type ParkingSlotCandidate,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "vehicle-pass-consumer" });

/** True for a Postgres unique/exclusion violation (SQLSTATE 23505 / 23P01). Mirrors modules/config-registry/repo.ts's helper of the same name. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23505" || code === "23P01";
}

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

      // No two ACTIVE vehicle passes may share a registration number — a
      // plate can only be "in" at one place at a time. This pre-check gives
      // a clear, specific error on the common (non-racing) path; the
      // partial unique index added in
      // migrations/0015_vehicle_passes_unique_active_plate.sql
      // (tenant_id, registration_number WHERE status = 'active') is the
      // real backstop against the same TOCTOU shape as the parking-slot
      // race below — see the catch around the insert further down.
      //
      // p.registrationNumber arrives here already canonical (uppercased,
      // [\s-] separators stripped): validators.ts's vehiclePassCreateBody
      // normalizes it via .transform() before this message is ever
      // published, and that validator is the only entry point into this
      // field (verified by repo-wide grep). That's why the comparison and
      // the index above deliberately still operate on the raw (now-always-
      // canonical) column rather than a matching functional
      // upper(regexp_replace(...)) expression: a second normalization
      // layer here would be redundant given the single write path, and
      // switching the index to a functional expression would risk failing
      // to build against any pre-existing non-canonical duplicate rows
      // predating this normalization.
      const duplicateActive = await tx
        .select({ id: vehiclePasses.id })
        .from(vehiclePasses)
        .where(
          and(
            eq(vehiclePasses.tenantId, msg.tenantId),
            eq(vehiclePasses.registrationNumber, p.registrationNumber),
            eq(vehiclePasses.status, "active"),
          ),
        )
        .limit(1);
      if (duplicateActive.length > 0) {
        throw new DomainError(
          "DUPLICATE_PLATE",
          `registration number '${p.registrationNumber}' already has an active vehicle pass`,
        );
      }

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

      // Mark slot occupied in DB — conditional on the slot STILL being free
      // at write time. Previously this UPDATE had no `AND occupied = false`
      // guard and no row lock, so two concurrent transactions that both read
      // the slot as free (above) before either wrote could both "win" it —
      // see this module's audit test file header for the reproduction. The
      // WHERE clause + `.returning()` row count turns the allocation from
      // "the caller observed it free a moment ago" into "the caller just
      // now atomically claimed it" — Postgres serializes concurrent UPDATEs
      // to the same row, so a loser's WHERE re-evaluates against the
      // now-committed `occupied = true` and matches zero rows.
      const updatedSlot = await tx
        .update(parkingSlots)
        .set({
          occupied: true,
          occupiedBy: p.id,
          updatedAt: new Date(),
        })
        .where(and(eq(parkingSlots.id, allocated.id), eq(parkingSlots.occupied, false)))
        .returning({ id: parkingSlots.id });

      if (updatedSlot.length === 0) {
        // Lost the race: another concurrent request claimed this exact slot
        // between our SELECT and this UPDATE. Same error/code a caller
        // would see if the read-time check above had found no candidates.
        throw new DomainError(
          "PARKING_UNAVAILABLE",
          `parking slot ${allocated.id} was claimed by another request before this allocation could commit`,
        );
      }

      // Insert vehicle_passes row.
      try {
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
      } catch (e) {
        if (isUniqueViolation(e)) {
          // TOCTOU backstop: the pre-check above raced with a concurrent
          // insert for the same plate and lost. migrations/0015's partial
          // unique index is what actually enforces this; translate its raw
          // constraint violation into the same clear error the pre-check
          // gives on the common path.
          throw new DomainError(
            "DUPLICATE_PLATE",
            `registration number '${p.registrationNumber}' already has an active vehicle pass`,
          );
        }
        throw e;
      }
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

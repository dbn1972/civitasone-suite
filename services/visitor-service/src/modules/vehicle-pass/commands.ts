/**
 * visitor-service: vehicle-pass command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 *
 * `vehiclePassCreate` — publishes a vehicle-pass creation request
 * (Requirement 14.1). Consumer calls `allocateParkingSlotOrThrow` from
 * domain.ts, marks the slot occupied, and inserts the vehicle_passes row.
 *
 * `parkingSlotRelease` — publishes a parking-slot release request on
 * visitor checkout (Requirement 14.5). Consumer calls
 * `releaseParkingSlot` from domain.ts and marks the slot available.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface VehiclePassCreateInput {
  passId: string;
  locationId: string;
  registrationNumber: string;
  vehicleType: "two_wheeler" | "car" | "suv" | "bus" | "truck";
  visitorCategory: "vip" | "standard" | "handicapped";
  driverName?: string | null;
}

/**
 * Publishes vehiclePassCreate command. The `id` returned is the
 * vehicle_passes.id. Consumer allocates a parking slot and inserts the row.
 */
export async function vehiclePassCreate(ctx: RequestContext, input: VehiclePassCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vehiclePassCreate, {
    messageId: id,
    type: COMMANDS.vehiclePassCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      passId: input.passId,
      locationId: input.locationId,
      registrationNumber: input.registrationNumber,
      vehicleType: input.vehicleType,
      visitorCategory: input.visitorCategory,
      driverName: input.driverName ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface ParkingSlotReleaseInput {
  vehiclePassId: string;
  parkingSlotId: string;
}

/**
 * Publishes parkingSlotRelease command. Triggered on visitor checkout when
 * a vehicle pass had a slot allocated (Requirement 14.5).
 */
export async function parkingSlotRelease(ctx: RequestContext, input: ParkingSlotReleaseInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.parkingSlotRelease, {
    messageId,
    type: COMMANDS.parkingSlotRelease,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      vehiclePassId: input.vehiclePassId,
      parkingSlotId: input.parkingSlotId,
      tenantId: ctx.tenantId,
    },
  });
  return { id: input.vehiclePassId, status: "accepted", correlationId: ctx.correlationId };
}

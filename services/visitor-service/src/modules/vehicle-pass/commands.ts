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
import { and, eq, inArray } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { vehiclePasses } from "./schema.js";

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

/**
 * Looks up whether `passId` (a `digital_passes.id`) has an active vehicle
 * pass with an allocated parking slot and, if so, publishes
 * `parkingSlotRelease` for it. Best-effort / fire-and-forget from the
 * caller's perspective — callers run this AFTER their own transaction has
 * committed and treat a failure here as non-fatal (logged, not retried),
 * mirroring the evacuation-roster-removal pattern on checkout
 * (modules/check-in/consumer.ts).
 *
 * Added 2026-08-27 (deep-verify): `parkingSlotRelease` above — command,
 * consumer, and DB update — already existed and was already tested, but
 * had ZERO call sites anywhere in the service, despite its own doc
 * comment claiming it was "triggered on visitor checkout" (Requirement
 * 14.5). Neither checkout nor visit-request cancellation ever actually
 * called it, so an allocated parking slot never became available again
 * through either path. This is the shared lookup+publish used by both.
 */
export async function releaseParkingIfAllocated(
  ctx: { tenantId: string; actorId: string; correlationId: string },
  passId: string,
): Promise<void> {
  // scopedRead (not a bare db.select()) so RLS sees the app.tenant_id GUC
  // -- see shared/db.ts's doc comment; a plain db.select() either throws
  // (this wrapper has no such method) or, under NOBYPASSRLS, fails closed
  // to zero rows.
  const rows = await scopedRead((tx) => tx
    .select({ id: vehiclePasses.id, parkingSlotId: vehiclePasses.parkingSlotId })
    .from(vehiclePasses)
    .where(
      and(
        eq(vehiclePasses.passId, passId),
        eq(vehiclePasses.tenantId, ctx.tenantId),
        inArray(vehiclePasses.status, ["active", "checked_in"]),
      ),
    ));

  const requestCtx: RequestContext = { ...ctx, actorType: "service_account", roles: [] };
  for (const row of rows) {
    if (!row.parkingSlotId) continue;
    await parkingSlotRelease(requestCtx, { vehiclePassId: row.id, parkingSlotId: row.parkingSlotId });
  }
}

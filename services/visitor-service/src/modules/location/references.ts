/**
 * visitor-service: synchronous reference checks for CQRS write routes (UAT FQ9 #8).
 *
 * Check-in / check-out and device register/update are `route → publish → 202`; the consumer's INSERT
 * then hit a foreign key (`check_ins.gate_id`, `devices.location_id` / `devices.gate_id`) for an
 * unknown gate or location and the message was dead-lettered silently, AFTER the client had already
 * been told 202. These checks run on the request path, under the caller's tenant (scopedRead → RLS),
 * so an unknown or cross-tenant reference is a 422 the client can act on. The consumers stay
 * defensive (they still dead-letter a dangling reference with a NonRetryableError), because a gate
 * can be removed between the check and the write.
 */
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { locations, gates } from "./schema.js";

/** 422 UNKNOWN_LOCATION unless `locationId` is a location of `tenantId`. */
export async function assertLocationExists(tenantId: string, locationId: string): Promise<void> {
  const rows = await scopedRead((tx) =>
    tx.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
      .limit(1),
  );
  if (rows.length === 0) {
    throw new HttpError(422, "UNKNOWN_LOCATION", `location '${locationId}' does not exist`);
  }
}

/**
 * 422 UNKNOWN_GATE unless `gateId` is a gate of `tenantId`; when `locationId` is given the gate must
 * also belong to that location (422 GATE_LOCATION_MISMATCH).
 */
export async function assertGateExists(tenantId: string, gateId: string, locationId?: string): Promise<void> {
  const rows = await scopedRead((tx) =>
    tx.select({ id: gates.id, locationId: gates.locationId }).from(gates)
      .where(and(eq(gates.id, gateId), eq(gates.tenantId, tenantId)))
      .limit(1),
  );
  const gate = rows[0];
  if (!gate) {
    throw new HttpError(422, "UNKNOWN_GATE", `gate '${gateId}' does not exist`);
  }
  if (locationId !== undefined && gate.locationId !== locationId) {
    throw new HttpError(422, "GATE_LOCATION_MISMATCH", `gate '${gateId}' does not belong to location '${locationId}'`);
  }
}

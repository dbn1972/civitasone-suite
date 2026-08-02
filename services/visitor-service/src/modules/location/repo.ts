import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  locations, areas, parkingSlots,
  type LocationRow,
  type AreaRow,
  type ParkingSlotRow,
} from "./schema.js";

// Task Q-95.1: location/area writes moved onto the queue.publish -> consumer
// CQRS pattern (see ./commands.ts + ./consumer.ts), matching every other
// mutating module in this service (modules/blacklist/repo.ts, etc.). This
// file is now read-only.
const RESOURCE = "location";

/**
 * A location row safe to serialize in API responses / cache: the per-location
 * RSA key pair is stripped. The PRIVATE key signs pass QR codes and must NEVER
 * leave the server; the PUBLIC key is only needed server-side (check-in QR
 * verification reads it via its own scoped query), so it is withheld from read
 * DTOs too. Callers that legitimately need a key select it explicitly.
 */
export type PublicLocationRow = Omit<LocationRow, "rsaPrivateKey" | "rsaPublicKey">;

/** Strip the RSA key pair from a location row before it leaves the service. */
export function toPublicLocation(row: LocationRow): PublicLocationRow {
  const { rsaPrivateKey: _priv, rsaPublicKey: _pub, ...rest } = row;
  return rest;
}

/**
 * `visitor:{tenant}:location:{id}` — cache.getOrLoad read-through, per
 * Requirement 22.2. Returns null (and does not cache) when the location
 * does not exist or belongs to another tenant.
 */
export async function getLocationById(tenantId: string, id: string): Promise<PublicLocationRow | null> {
  return cache.getOrLoad<PublicLocationRow>(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await scopedRead((tx) => tx.select().from(locations)
      .where(and(eq(locations.id, id), eq(locations.tenantId, tenantId))));
    const row = rows[0];
    return row ? toPublicLocation(row) : null;
  });
}

export async function listLocations(tenantId: string): Promise<PublicLocationRow[]> {
  const rows = await scopedRead((tx) => tx.select().from(locations).where(eq(locations.tenantId, tenantId)));
  return rows.map(toPublicLocation);
}

export async function getAreaById(tenantId: string, id: string): Promise<AreaRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(areas)
    .where(and(eq(areas.id, id), eq(areas.tenantId, tenantId))));
  return rows[0] ?? null;
}

export async function listAreas(tenantId: string, locationId: string): Promise<AreaRow[]> {
  return scopedRead((tx) => tx.select().from(areas)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.locationId, locationId))));
}

export async function listParkingSlots(tenantId: string, locationId: string): Promise<ParkingSlotRow[]> {
  return scopedRead((tx) => tx.select().from(parkingSlots)
    .where(and(eq(parkingSlots.tenantId, tenantId), eq(parkingSlots.locationId, locationId))));
}

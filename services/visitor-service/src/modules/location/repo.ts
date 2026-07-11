import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  locations, areas, parkingSlots,
  type LocationRow, type LocationInsert,
  type AreaRow, type AreaInsert,
  type ParkingSlotRow,
} from "./schema.js";

// Reference/configuration data (locations, areas, gates, parking) has no
// CQRS command/consumer step (see tasks.md §3 — no commands.ts/consumer.ts
// for this module): writes go straight to Postgres here, followed by a
// direct cache invalidation, matching the admin-managed-reference-data
// pattern used by location-service's `locations` module (sample-data
// endpoints) rather than the queue.publish -> consumer write pattern used
// by the visitor lifecycle modules (visit-request, digital-pass, etc.).
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

export interface CreateLocationInput {
  name: string;
  address?: string | undefined;
  businessHours: LocationInsert["businessHours"];
  capacity?: number | undefined;
  capacityThreshold?: number | undefined;
  active?: boolean | undefined;
}

export async function createLocation(
  tenantId: string,
  actorId: string,
  input: CreateLocationInput,
): Promise<PublicLocationRow> {
  const now = new Date();
  const id = randomUUID();
  const row: LocationInsert = {
    id,
    tenantId,
    name: input.name,
    address: input.address ?? null,
    businessHours: input.businessHours,
    ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    ...(input.capacityThreshold !== undefined ? { capacityThreshold: input.capacityThreshold } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  };
  const [created] = await db.transaction((tx) => tx.insert(locations).values(row).returning());
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE, id));
  return toPublicLocation(created!);
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

export interface CreateAreaInput {
  name: string;
  securityLevel?: number | undefined;
  authorizedApprovers?: string[] | undefined;
  escortRequired?: boolean | undefined;
  active?: boolean | undefined;
}

export async function createArea(
  tenantId: string,
  actorId: string,
  locationId: string,
  input: CreateAreaInput,
): Promise<AreaRow> {
  const now = new Date();
  const row: AreaInsert = {
    id: randomUUID(),
    tenantId,
    locationId,
    name: input.name,
    ...(input.securityLevel !== undefined ? { securityLevel: input.securityLevel } : {}),
    ...(input.authorizedApprovers !== undefined ? { authorizedApprovers: input.authorizedApprovers } : {}),
    ...(input.escortRequired !== undefined ? { escortRequired: input.escortRequired } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  };
  const [created] = await db.transaction((tx) => tx.insert(areas).values(row).returning());
  // Areas are read as part of a location's detail in some future consumers;
  // invalidate the parent location's cache entry too so a subsequent read
  // reflects the new area if it ever gets embedded there.
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE, locationId));
  return created!;
}

export async function listParkingSlots(tenantId: string, locationId: string): Promise<ParkingSlotRow[]> {
  return scopedRead((tx) => tx.select().from(parkingSlots)
    .where(and(eq(parkingSlots.tenantId, tenantId), eq(parkingSlots.locationId, locationId))));
}

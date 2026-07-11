import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
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
 * `visitor:{tenant}:location:{id}` — cache.getOrLoad read-through, per
 * Requirement 22.2. Returns null (and does not cache) when the location
 * does not exist or belongs to another tenant.
 */
export async function getLocationById(tenantId: string, id: string): Promise<LocationRow | null> {
  return cache.getOrLoad<LocationRow>(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await db.select().from(locations)
      .where(and(eq(locations.id, id), eq(locations.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

export async function listLocations(tenantId: string): Promise<LocationRow[]> {
  return db.select().from(locations).where(eq(locations.tenantId, tenantId));
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
): Promise<LocationRow> {
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
  const [created] = await db.insert(locations).values(row).returning();
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE, id));
  return created!;
}

export async function getAreaById(tenantId: string, id: string): Promise<AreaRow | null> {
  const rows = await db.select().from(areas)
    .where(and(eq(areas.id, id), eq(areas.tenantId, tenantId)));
  return rows[0] ?? null;
}

export async function listAreas(tenantId: string, locationId: string): Promise<AreaRow[]> {
  return db.select().from(areas)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.locationId, locationId)));
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
  const [created] = await db.insert(areas).values(row).returning();
  // Areas are read as part of a location's detail in some future consumers;
  // invalidate the parent location's cache entry too so a subsequent read
  // reflects the new area if it ever gets embedded there.
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE, locationId));
  return created!;
}

export async function listParkingSlots(tenantId: string, locationId: string): Promise<ParkingSlotRow[]> {
  return db.select().from(parkingSlots)
    .where(and(eq(parkingSlots.tenantId, tenantId), eq(parkingSlots.locationId, locationId)));
}

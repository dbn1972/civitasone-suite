import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { geofences, type GeofenceRow, type GeofenceInsert, type GeofenceView } from "./schema.js";
import { haversineDistance } from "./validators.js";

function toView(r: GeofenceRow): GeofenceView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    type: r.type,
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    radiusMeters: r.radiusMeters,
    polygon: r.polygon as Array<{ lat: number; lng: number }> | null,
    active: r.active,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<GeofenceView | null> {
  const rows = await scopedRead((tx) => tx.select().from(geofences).where(eq(geofences.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<GeofenceView[]> {
  const rows = await scopedRead((tx) => tx.select().from(geofences)
    .where(eq(geofences.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

export async function listActiveByTenant(tenantId: string): Promise<GeofenceView[]> {
  const rows = await scopedRead((tx) => tx.select().from(geofences)
    .where(and(eq(geofences.tenantId, tenantId), eq(geofences.active, true))));
  return rows.map(toView);
}

/** Find all geofences within a radius (in meters) of a given point. */
export async function findNearby(tenantId: string, lat: number, lng: number, maxDistanceMeters: number): Promise<GeofenceView[]> {
  const all = await listActiveByTenant(tenantId);
  return all.filter((g) => {
    const dist = haversineDistance(lat, lng, g.centerLat, g.centerLng);
    return dist <= maxDistanceMeters;
  });
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: GeofenceInsert): Promise<void> {
  await tx.insert(geofences).values(row);
}

export async function update(tx: Writer, id: string, tenantId: string, data: Partial<GeofenceInsert>): Promise<void> {
  await tx.update(geofences)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(geofences.id, id), eq(geofences.tenantId, tenantId)));
}

export { toView };

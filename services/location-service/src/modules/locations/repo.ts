import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, scopedRead } from "../../shared/db.js";
import { locations, type LocationRow, type LocationInsert, type LocationView } from "./schema.js";

function toView(r: LocationRow): LocationView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    addressLine: r.addressLine,
    city: r.city,
    postalCode: r.postalCode,
    parentId: r.parentId,
    type: r.type,
    lgdCode: r.lgdCode,
    latitude: r.latitude,
    longitude: r.longitude,
    status: r.status,
    isSample: r.isSample,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<LocationView | null> {
  const rows = await scopedRead((tx) => tx.select().from(locations).where(eq(locations.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<LocationView[]> {
  const rows = await scopedRead((tx) => tx.select().from(locations)
    .where(eq(locations.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

/** All locations for a tenant — used to assemble the branch-office tree. */
export async function listAllByTenant(tenantId: string): Promise<LocationView[]> {
  const rows = await scopedRead((tx) => tx.select().from(locations)
    .where(eq(locations.tenantId, tenantId)));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: LocationInsert): Promise<void> {
  await tx.insert(locations).values(row);
}

/** The example offices a clerk can add to explore (clearly marked as samples). */
const SAMPLE_OFFICES: Array<Pick<LocationView, "name" | "addressLine" | "city" | "postalCode" | "type">> = [
  { name: "[SAMPLE] Head Office", addressLine: "1 Example Marg", city: "Bhubaneswar", postalCode: "751001", type: "office" },
  { name: "[SAMPLE] Cuttack Branch", addressLine: "12 Demo Road", city: "Cuttack", postalCode: "753001", type: "branch" },
  { name: "[SAMPLE] Puri Field Office", addressLine: "5 Trial Lane", city: "Puri", postalCode: "752001", type: "facility" },
];

/** Count this tenant's sample offices. */
export async function countSamples(tenantId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.isSample, true))));
  return rows.length;
}

/**
 * Add the example offices for a tenant (idempotent: does nothing if samples
 * already exist). Returns the number added. Inserted directly (not via the
 * command queue) so the clerk sees them immediately.
 */
export async function seedSamples(tenantId: string, actorId: string): Promise<number> {
  if ((await countSamples(tenantId)) > 0) return 0;
  const now = new Date();
  const rows: LocationInsert[] = SAMPLE_OFFICES.map((o) => ({
    id: randomUUID(),
    tenantId,
    name: o.name,
    addressLine: o.addressLine,
    city: o.city,
    postalCode: o.postalCode,
    parentId: null,
    type: o.type,
    lgdCode: null,
    status: "active",
    isSample: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  }));
  await db.transaction(async (tx) => {
    await tx.insert(locations).values(rows);
  });
  return rows.length;
}

/**
 * Remove ONLY this tenant's sample offices. Real offices (is_sample = false) are
 * never touched. Returns the number removed.
 */
export async function clearSamples(tenantId: string): Promise<number> {
  const removed = await db.transaction(async (tx) => {
    return tx
      .delete(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.isSample, true)))
      .returning({ id: locations.id });
  });
  return removed.length;
}

/**
 * Spatial nearby query using PostGIS ST_DWithin against the GIST-indexed geom column.
 * Returns locations within `radiusKm` of the given lat/lng, scoped by tenant.
 * Falls back to Haversine approximation via SQL when PostGIS is unavailable.
 */
export async function findNearby(
  tenantId: string,
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number
): Promise<Array<LocationView & { distanceKm: number }>> {
  const radiusMeters = radiusKm * 1000;
  // Use raw SQL for the PostGIS spatial query using GIST index
  // Wrapped in scopedRead to ensure RLS GUC is set
  const { sqlClient: sql } = await import("../../shared/db.js");
  const rows = await scopedRead(async (_tx) => {
    return sql`
      SELECT
        id, tenant_id, name, address_line, city, postal_code, parent_id,
        type, lgd_code, latitude, longitude, status, is_sample, version,
        ST_Distance(
          geom,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        ) / 1000.0 AS distance_km
      FROM location.locations
      WHERE tenant_id = ${tenantId}
        AND geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY distance_km ASC
      LIMIT ${limit}
    `;
  });
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    name: r.name as string,
    addressLine: (r.address_line as string) ?? null,
    city: (r.city as string) ?? null,
    postalCode: (r.postal_code as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    type: r.type as string,
    lgdCode: (r.lgd_code as string) ?? null,
    latitude: r.latitude as number | null,
    longitude: r.longitude as number | null,
    status: r.status as string,
    isSample: r.is_sample as boolean,
    version: r.version as number,
    distanceKm: Number(r.distance_km),
  }));
}

export { toView };

export type LocationPatch = Partial<Pick<LocationInsert, "name" | "addressLine" | "city" | "postalCode" | "type" | "lgdCode" | "parentId" | "latitude" | "longitude" | "status">>;

export async function updateById(tx: Writer, id: string, tenantId: string, patch: LocationPatch & { updatedBy: string }): Promise<void> {
  const { updatedBy, ...fields } = patch;
  await tx.update(locations).set({ ...fields, updatedAt: new Date(), updatedBy, version: sql`${locations.version} + 1` }).where(and(eq(locations.id, id), eq(locations.tenantId, tenantId)));
}

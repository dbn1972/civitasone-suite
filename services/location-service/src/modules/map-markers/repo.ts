import { sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { geoPoints, type Marker } from "./schema.js";

type Row = Record<string, unknown>;

/** Upsert a geo-point (idempotent on tenant+domain+ref_id). Used by the HTTP
 *  register endpoint and the queue consumer so other services can register
 *  monitoring points. */
export async function upsertGeoPoint(
  tenantId: string,
  actorId: string,
  p: { domain: string; refId: string; lat: number; lng: number; label?: string | null | undefined; status?: string | null | undefined },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(geoPoints).values({
      tenantId, domain: p.domain, refId: p.refId, lat: String(p.lat), lng: String(p.lng),
      label: p.label ?? null, status: p.status ?? "active", createdBy: actorId,
    }).onConflictDoUpdate({
      target: [geoPoints.tenantId, geoPoints.domain, geoPoints.refId],
      set: { lat: String(p.lat), lng: String(p.lng), label: p.label ?? null, status: p.status ?? "active", updatedAt: new Date() },
    });
  });
}

/**
 * UAT-P2-D1 (/locations/maps/monitoring 500): the parcel branch reads
 * location.cadastral_parcels, created by migration 0014, which needs PostGIS
 * (geometry column + ST_Centroid). On a cluster without PostGIS that
 * migration never applied, the relation is missing, and the whole UNION
 * failed with 42P01 -> HTTP 500 for every caller, hiding the assets that do
 * exist. location.geo_points (0019) needs PostGIS too, so it is probed the
 * same way. Optional sources are now probed first (same
 * to_regclass pattern the geofence branch already used) and skipped when
 * absent, so the feed degrades to what the database actually holds.
 */
async function optionalSources(): Promise<{ parcels: boolean; geoPoints: boolean; geofences: boolean }> {
  const rows = await scopedRead((tx) =>
    tx.execute(sql`SELECT to_regclass('location.cadastral_parcels') AS parcels,
                          to_regclass('location.geo_points') AS geo_points,
                          to_regclass('geofence.geofences') AS geofences`),
  );
  const r = (rows as unknown as Row[])[0];
  return { parcels: !!(r && r.parcels), geoPoints: !!(r && r.geo_points), geofences: !!(r && r.geofences) };
}

/**
 * SVC-119: aggregate location-owned geo-entities into a single marker feed:
 * infrastructure assets, cadastral parcels (centroids), registered geo-points,
 * and geofences (when that schema is present). Tenant-scoped by RLS; supports
 * optional domain, status, and bbox (minLng,minLat,maxLng,maxLat) filters.
 */
export async function markers(
  tenantId: string,
  filter: {
    domain?: string | undefined;
    status?: string | undefined;
    bbox?: [number, number, number, number] | undefined;
    /** Only records created at or before this instant (the "as of" view). */
    createdBefore?: Date | undefined;
  },
  limit: number,
): Promise<Marker[]> {
  const sources = await optionalSources();
  const branches: SQL[] = [
    sql`SELECT id::text AS id, 'infrastructure' AS domain, id::text AS ref_id, lat::float8 AS lat, lng::float8 AS lng, name AS label, status, created_at
        FROM location.infrastructure_assets WHERE tenant_id = ${tenantId}`,
  ];
  if (sources.parcels) {
    branches.push(sql`SELECT id::text AS id, 'parcel' AS domain, id::text AS ref_id, ST_Y(ST_Centroid(geom))::float8 AS lat, ST_X(ST_Centroid(geom))::float8 AS lng, parcel_no AS label, status, created_at
        FROM location.cadastral_parcels WHERE tenant_id = ${tenantId} AND geom IS NOT NULL`);
  }
  if (sources.geoPoints) {
    branches.push(sql`SELECT id::text AS id, domain, ref_id, lat::float8 AS lat, lng::float8 AS lng, label, status, created_at
        FROM location.geo_points WHERE tenant_id = ${tenantId}`);
  }
  if (sources.geofences) {
    branches.push(sql`SELECT id::text AS id, 'geofence' AS domain, id::text AS ref_id, center_lat::float8 AS lat, center_lng::float8 AS lng, name AS label,
        CASE WHEN active THEN 'active' ELSE 'inactive' END AS status, created_at
        FROM geofence.geofences WHERE tenant_id = ${tenantId}`);
  }

  const unioned = sql.join(branches, sql` UNION ALL `);
  const conds: SQL[] = [];
  if (filter.domain) conds.push(sql`m.domain = ${filter.domain}`);
  if (filter.status) conds.push(sql`m.status = ${filter.status}`);
  if (filter.bbox) {
    const [minLng, minLat, maxLng, maxLat] = filter.bbox;
    conds.push(sql`m.lng BETWEEN ${minLng} AND ${maxLng} AND m.lat BETWEEN ${minLat} AND ${maxLat}`);
  }
  if (filter.createdBefore) conds.push(sql`m.created_at <= ${filter.createdBefore.toISOString()}::timestamptz`);
  const where = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT m.id, m.domain, m.ref_id, m.lat, m.lng, m.label, m.status
    FROM (${unioned}) m${where}
    ORDER BY m.domain, m.label NULLS LAST
    LIMIT ${limit}
  `));
  return (rows as unknown as Row[]).map((r) => ({
    id: r.id as string,
    domain: r.domain as string,
    refId: r.ref_id as string,
    lat: Number(r.lat),
    lng: Number(r.lng),
    label: (r.label as string) ?? null,
    status: r.status as string,
  }));
}

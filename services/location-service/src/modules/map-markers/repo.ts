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

async function geofenceExists(): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.execute(sql`SELECT to_regclass('geofence.geofences') AS reg`));
  const r = (rows as unknown as Row[])[0];
  return !!(r && r.reg);
}

/**
 * SVC-119: aggregate location-owned geo-entities into a single marker feed:
 * infrastructure assets, cadastral parcels (centroids), registered geo-points,
 * and geofences (when that schema is present). Tenant-scoped by RLS; supports
 * optional domain, status, and bbox (minLng,minLat,maxLng,maxLat) filters.
 */
export async function markers(
  tenantId: string,
  filter: { domain?: string | undefined; status?: string | undefined; bbox?: [number, number, number, number] | undefined },
  limit: number,
): Promise<Marker[]> {
  const branches: SQL[] = [
    sql`SELECT id::text AS id, 'infrastructure' AS domain, id::text AS ref_id, lat::float8 AS lat, lng::float8 AS lng, name AS label, status
        FROM location.infrastructure_assets WHERE tenant_id = ${tenantId}`,
    sql`SELECT id::text AS id, 'parcel' AS domain, id::text AS ref_id, ST_Y(ST_Centroid(geom))::float8 AS lat, ST_X(ST_Centroid(geom))::float8 AS lng, parcel_no AS label, status
        FROM location.cadastral_parcels WHERE tenant_id = ${tenantId} AND geom IS NOT NULL`,
    sql`SELECT id::text AS id, domain, ref_id, lat::float8 AS lat, lng::float8 AS lng, label, status
        FROM location.geo_points WHERE tenant_id = ${tenantId}`,
  ];
  if (await geofenceExists()) {
    branches.push(sql`SELECT id::text AS id, 'geofence' AS domain, id::text AS ref_id, center_lat::float8 AS lat, center_lng::float8 AS lng, name AS label,
        CASE WHEN active THEN 'active' ELSE 'inactive' END AS status
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

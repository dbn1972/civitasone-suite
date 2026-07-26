import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

export type SpatialPoint = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  distanceKm?: number;
};

type Row = Record<string, unknown>;

function toPoint(r: Row): SpatialPoint {
  const p: SpatialPoint = {
    id: r.id as string,
    name: r.name as string,
    type: r.type as string,
    lat: Number(r.latitude),
    lng: Number(r.longitude),
  };
  if (r.distance_km !== undefined && r.distance_km !== null) p.distanceKm = Number(r.distance_km);
  return p;
}

/** SVC-118: locations within `radiusKm` of a point, via ST_DWithin on geography. */
export async function withinRadius(tenantId: string, lat: number, lng: number, radiusKm: number, limit: number): Promise<SpatialPoint[]> {
  const meters = radiusKm * 1000;
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, name, type, latitude, longitude,
           ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) / 1000.0 AS distance_km
    FROM location.locations
    WHERE tenant_id = ${tenantId}
      AND geom IS NOT NULL
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${meters})
    ORDER BY distance_km ASC
    LIMIT ${limit}
  `));
  return (rows as unknown as Row[]).map(toPoint);
}

/** SVC-118: locations inside a polygon, via ST_Within against a GeoJSON polygon. */
export async function withinPolygon(tenantId: string, polygon: Array<{ lat: number; lng: number }>, limit: number): Promise<SpatialPoint[]> {
  const ring = polygon.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0]!, first[1]!]);
  const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, name, type, latitude, longitude
    FROM location.locations
    WHERE tenant_id = ${tenantId}
      AND geom IS NOT NULL
      AND ST_Within(geom, ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))
    LIMIT ${limit}
  `));
  return (rows as unknown as Row[]).map(toPoint);
}

export type Cluster = {
  clusterId: number;
  count: number;
  centroidLat: number;
  centroidLng: number;
};

/** SVC-118: k-means spatial clusters of a tenant's geolocated locations. */
export async function clusters(tenantId: string, requestedK: number): Promise<Cluster[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    WITH pts AS (
      SELECT id, geom FROM location.locations WHERE tenant_id = ${tenantId} AND geom IS NOT NULL
    ),
    n AS (SELECT count(*)::int AS c FROM pts),
    clustered AS (
      SELECT id, geom,
             ST_ClusterKMeans(geom, LEAST(${requestedK}, GREATEST((SELECT c FROM n), 1))) OVER () AS cid
      FROM pts
    )
    SELECT cid AS cluster_id, count(*)::int AS cnt,
           ST_Y(ST_Centroid(ST_Collect(geom))) AS centroid_lat,
           ST_X(ST_Centroid(ST_Collect(geom))) AS centroid_lng
    FROM clustered
    GROUP BY cid
    ORDER BY cid
  `));
  return (rows as unknown as Row[]).map((r) => ({
    clusterId: Number(r.cluster_id),
    count: Number(r.cnt),
    centroidLat: Number(r.centroid_lat),
    centroidLng: Number(r.centroid_lng),
  }));
}

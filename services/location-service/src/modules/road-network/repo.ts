import { and, eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { routeNetworks, type RouteNetworkRow, type RoadSegmentView } from "./schema.js";

type Row = Record<string, unknown>;

function segToView(r: Row): RoadSegmentView {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    name: r.name as string,
    roadClass: r.road_class as string,
    fromNode: r.from_node as string,
    toNode: r.to_node as string,
    lengthMeters: Number(r.length_meters),
    status: r.status as string,
    coordinates: r.coordinates ? (JSON.parse(r.coordinates as string).coordinates as Array<[number, number]>) : [],
    version: Number(r.version),
  };
}

/** Create a road segment; geom + length derived from the LineString coordinates. */
export async function createSegment(
  tenantId: string,
  actorId: string,
  input: { id: string; name: string; roadClass: string; fromNode: string; toNode: string; coordinates: Array<[number, number]> },
): Promise<void> {
  const geojson = JSON.stringify({ type: "LineString", coordinates: input.coordinates });
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO location.road_segments (id, tenant_id, name, road_class, from_node, to_node, geom, length_meters, status, created_by, version)
      VALUES (
        ${input.id}, ${tenantId}, ${input.name}, ${input.roadClass}, ${input.fromNode}, ${input.toNode},
        ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
        ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography),
        'active', ${actorId}, 1
      )
    `);
  });
}

export async function listSegments(tenantId: string, limit: number, offset: number): Promise<RoadSegmentView[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id, name, road_class, from_node, to_node, length_meters, status, version,
           ST_AsGeoJSON(geom) AS coordinates
    FROM location.road_segments
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));
  return (rows as unknown as Row[]).map(segToView);
}

export async function getSegment(id: string, tenantId: string): Promise<RoadSegmentView | null> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id, name, road_class, from_node, to_node, length_meters, status, version,
           ST_AsGeoJSON(geom) AS coordinates
    FROM location.road_segments
    WHERE id = ${id} AND tenant_id = ${tenantId}
    LIMIT 1
  `));
  const r = (rows as unknown as Row[])[0];
  return r ? segToView(r) : null;
}

export async function deleteSegment(id: string, tenantId: string): Promise<number> {
  const removed = await db.transaction(async (tx) => {
    const res = await tx.execute(sql`DELETE FROM location.road_segments WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id`);
    return (res as unknown as Row[]).length;
  });
  return removed;
}

/** Basic connectivity: segments sharing a node with the given segment. */
export async function connectedSegments(id: string, tenantId: string): Promise<RoadSegmentView[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    WITH s AS (SELECT from_node, to_node FROM location.road_segments WHERE id = ${id} AND tenant_id = ${tenantId})
    SELECT r.id, r.tenant_id, r.name, r.road_class, r.from_node, r.to_node, r.length_meters, r.status, r.version,
           ST_AsGeoJSON(r.geom) AS coordinates
    FROM location.road_segments r, s
    WHERE r.tenant_id = ${tenantId} AND r.id <> ${id}
      AND (r.from_node IN (s.from_node, s.to_node) OR r.to_node IN (s.from_node, s.to_node))
    ORDER BY r.name
  `));
  return (rows as unknown as Row[]).map(segToView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function createNetwork(
  tenantId: string,
  actorId: string,
  input: { id: string; name: string; description?: string | null | undefined; segmentIds: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(routeNetworks).values({
      id: input.id, tenantId, name: input.name, description: input.description ?? null,
      segmentIds: input.segmentIds, status: "active", createdBy: actorId, version: 1,
    });
  });
}

function netToView(r: RouteNetworkRow) {
  return {
    id: r.id, tenantId: r.tenantId, name: r.name, description: r.description,
    segmentIds: (r.segmentIds as string[]) ?? [], status: r.status, version: r.version,
  };
}

export async function listNetworks(tenantId: string, limit: number, offset: number) {
  const rows = await scopedRead((tx) =>
    tx.select().from(routeNetworks).where(eq(routeNetworks.tenantId, tenantId))
      .orderBy(desc(routeNetworks.createdAt)).limit(limit).offset(offset));
  return rows.map(netToView);
}

export async function getNetwork(id: string, tenantId: string) {
  const rows = await scopedRead((tx) =>
    tx.select().from(routeNetworks).where(and(eq(routeNetworks.id, id), eq(routeNetworks.tenantId, tenantId))).limit(1));
  return rows[0] ? netToView(rows[0]) : null;
}

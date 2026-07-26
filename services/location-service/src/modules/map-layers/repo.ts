import { and, eq, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { mapLayers, type MapLayerRow, type MapLayerView } from "./schema.js";

function toView(r: MapLayerRow): MapLayerView {
  return {
    id: r.id,
    name: r.name,
    sourceType: r.sourceType,
    url: r.url,
    styleJson: (r.styleJson as Record<string, unknown> | null) ?? null,
    zIndex: r.zIndex,
    visible: r.visible,
    version: r.version,
  };
}

export async function list(tenantId: string): Promise<MapLayerView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(mapLayers).where(eq(mapLayers.tenantId, tenantId)).orderBy(asc(mapLayers.zIndex)));
  return rows.map(toView);
}

export async function findById(id: string, tenantId: string): Promise<MapLayerView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(mapLayers).where(and(eq(mapLayers.id, id), eq(mapLayers.tenantId, tenantId))).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function create(
  tenantId: string,
  actorId: string,
  input: { id: string; name: string; sourceType: string; url: string; styleJson?: Record<string, unknown> | null | undefined; zIndex: number; visible: boolean },
): Promise<MapLayerView> {
  const row = await db.transaction(async (tx) => {
    const inserted = await tx.insert(mapLayers).values({
      id: input.id, tenantId, name: input.name, sourceType: input.sourceType, url: input.url,
      styleJson: input.styleJson ?? null, zIndex: input.zIndex, visible: input.visible, createdBy: actorId, version: 1,
    }).returning();
    return inserted[0]!;
  });
  return toView(row);
}

export async function patch(
  id: string,
  tenantId: string,
  data: {
    name?: string | undefined; sourceType?: string | undefined; url?: string | undefined;
    styleJson?: Record<string, unknown> | null | undefined; zIndex?: number | undefined; visible?: boolean | undefined;
  },
): Promise<MapLayerView | null> {
  const set: Record<string, unknown> = { updatedAt: new Date(), version: sql`${mapLayers.version} + 1` };
  if (data.name !== undefined) set.name = data.name;
  if (data.sourceType !== undefined) set.sourceType = data.sourceType;
  if (data.url !== undefined) set.url = data.url;
  if (data.styleJson !== undefined) set.styleJson = data.styleJson;
  if (data.zIndex !== undefined) set.zIndex = data.zIndex;
  if (data.visible !== undefined) set.visible = data.visible;
  const rows = await db.transaction(async (tx) =>
    tx.update(mapLayers).set(set).where(and(eq(mapLayers.id, id), eq(mapLayers.tenantId, tenantId))).returning());
  return rows[0] ? toView(rows[0]) : null;
}

export async function remove(id: string, tenantId: string): Promise<number> {
  const rows = await db.transaction(async (tx) =>
    tx.delete(mapLayers).where(and(eq(mapLayers.id, id), eq(mapLayers.tenantId, tenantId))).returning({ id: mapLayers.id }));
  return rows.length;
}

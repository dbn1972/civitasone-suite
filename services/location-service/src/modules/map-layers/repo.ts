import { and, eq, asc, sql } from "drizzle-orm";
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

export type MapLayerInsert = {
  id: string;
  tenantId: string;
  name: string;
  sourceType: string;
  url: string;
  styleJson?: Record<string, unknown> | null;
  zIndex: number;
  visible: boolean;
  createdBy: string;
  updatedBy?: string;
  version: number;
};

export type Writer = Pick<typeof db, "insert" | "update" | "delete">;

export async function insert(tx: Writer, row: MapLayerInsert): Promise<void> {
  await tx.insert(mapLayers).values({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sourceType: row.sourceType,
    url: row.url,
    styleJson: row.styleJson ?? null,
    zIndex: row.zIndex,
    visible: row.visible,
    createdBy: row.createdBy,
    version: row.version,
  });
}

export async function update(
  tx: Writer,
  id: string,
  tenantId: string,
  data: Partial<MapLayerInsert>,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date(), version: sql`${mapLayers.version} + 1` };
  if (data.name !== undefined) set.name = data.name;
  if (data.sourceType !== undefined) set.sourceType = data.sourceType;
  if (data.url !== undefined) set.url = data.url;
  if (data.styleJson !== undefined) set.styleJson = data.styleJson;
  if (data.zIndex !== undefined) set.zIndex = data.zIndex;
  if (data.visible !== undefined) set.visible = data.visible;
  await tx.update(mapLayers).set(set).where(and(eq(mapLayers.id, id), eq(mapLayers.tenantId, tenantId)));
}

export async function remove(tx: Writer, id: string, tenantId: string): Promise<number> {
  const rows = await tx
    .delete(mapLayers)
    .where(and(eq(mapLayers.id, id), eq(mapLayers.tenantId, tenantId)))
    .returning({ id: mapLayers.id });
  return rows.length;
}

export { toView };

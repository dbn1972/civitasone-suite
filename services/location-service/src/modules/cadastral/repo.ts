import { and, eq, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import {
  cadastralParcels, cadastralParcelHistory,
  type CadastralParcelRow, type CadastralParcelView,
} from "./schema.js";

function toView(r: CadastralParcelRow): CadastralParcelView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    parcelNo: r.parcelNo,
    village: r.village,
    district: r.district,
    areaSquareMeters: Number(r.areaSquareMeters),
    boundary: (r.boundary as Array<{ lat: number; lng: number }>) ?? [],
    landUse: r.landUse,
    ownershipType: r.ownershipType,
    status: r.status,
    version: r.version,
  };
}

export async function listParcels(
  tenantId: string,
  filter: { village?: string | undefined; district?: string | undefined },
  limit: number,
  offset: number,
): Promise<CadastralParcelView[]> {
  const conds = [eq(cadastralParcels.tenantId, tenantId)];
  if (filter.village) conds.push(eq(cadastralParcels.village, filter.village));
  if (filter.district) conds.push(eq(cadastralParcels.district, filter.district));
  const rows = await scopedRead((tx) =>
    tx.select().from(cadastralParcels).where(and(...conds))
      .orderBy(desc(cadastralParcels.createdAt)).limit(limit).offset(offset));
  return rows.map(toView);
}

export async function findParcel(id: string, tenantId: string): Promise<CadastralParcelView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(cadastralParcels).where(and(eq(cadastralParcels.id, id), eq(cadastralParcels.tenantId, tenantId))).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function parcelHistory(parcelId: string, tenantId: string): Promise<Array<{ id: string; eventType: string; detail: Record<string, unknown> | null; actorId: string; createdAt: string }>> {
  const rows = await scopedRead((tx) =>
    tx.select().from(cadastralParcelHistory)
      .where(and(eq(cadastralParcelHistory.parcelId, parcelId), eq(cadastralParcelHistory.tenantId, tenantId)))
      .orderBy(desc(cadastralParcelHistory.createdAt)));
  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    actorId: r.actorId,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

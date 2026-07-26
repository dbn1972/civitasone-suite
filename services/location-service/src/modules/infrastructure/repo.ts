import { and, eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { infrastructureAssets, type InfrastructureAssetRow, type InfrastructureAssetInsert, type InfrastructureAssetView } from "./schema.js";

function toView(r: InfrastructureAssetRow): InfrastructureAssetView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    type: r.type,
    lat: Number(r.lat),
    lng: Number(r.lng),
    capacity: r.capacity,
    conditionScore: r.conditionScore,
    status: r.status,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<InfrastructureAssetView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(infrastructureAssets)
      .where(eq(infrastructureAssets.tenantId, tenantId))
      .orderBy(desc(infrastructureAssets.createdAt))
      .limit(limit).offset(offset));
  return rows.map(toView);
}

export async function findById(id: string, tenantId: string): Promise<InfrastructureAssetView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(infrastructureAssets).where(and(eq(infrastructureAssets.id, id), eq(infrastructureAssets.tenantId, tenantId))).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: InfrastructureAssetInsert): Promise<void> {
  await tx.insert(infrastructureAssets).values(row);
}

export { toView };

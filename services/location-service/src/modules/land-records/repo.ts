import { and, eq, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { landRecords, type LandRecordRow, type LandRecordInsert, type LandRecordView } from "./schema.js";

function toView(r: LandRecordRow): LandRecordView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    surveyNo: r.surveyNo,
    khasraNo: r.khasraNo,
    village: r.village,
    district: r.district,
    areaHectares: Number(r.areaHectares),
    ownerName: r.ownerName,
    landType: r.landType,
    coordinates: (r.coordinates as Array<{ lat: number; lng: number }> | null) ?? null,
    status: r.status,
    mutationDate: r.mutationDate ? new Date(r.mutationDate).toISOString() : null,
    mutationType: r.mutationType,
    documentRef: r.documentRef,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<LandRecordView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(landRecords)
      .where(eq(landRecords.tenantId, tenantId))
      .orderBy(desc(landRecords.createdAt))
      .limit(limit)
      .offset(offset));
  return rows.map(toView);
}

export async function findById(id: string, tenantId: string): Promise<LandRecordView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(landRecords).where(and(eq(landRecords.id, id), eq(landRecords.tenantId, tenantId))).limit(1));
  const row = rows[0];
  return row ? toView(row) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: LandRecordInsert): Promise<void> {
  await tx.insert(landRecords).values(row);
}

/** Mutation: change owner + record mutation metadata, bump version. */
export async function applyMutation(
  tx: Writer,
  id: string,
  tenantId: string,
  data: { ownerName: string; mutationType: string },
): Promise<number> {
  const updated = await tx.update(landRecords)
    .set({
      ownerName: data.ownerName,
      mutationType: data.mutationType,
      mutationDate: new Date(),
      updatedAt: new Date(),
      version: sql`${landRecords.version} + 1`,
    })
    .where(and(eq(landRecords.id, id), eq(landRecords.tenantId, tenantId)))
    .returning({ id: landRecords.id });
  return updated.length;
}

export { toView };

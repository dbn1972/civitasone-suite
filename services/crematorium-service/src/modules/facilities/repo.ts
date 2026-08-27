import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { crematoriumFacilities, type FacilityRow, type FacilityInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<FacilityRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumFacilities)
      .where(and(eq(crematoriumFacilities.id, id), eq(crematoriumFacilities.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: FacilityRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(crematoriumFacilities.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(crematoriumFacilities.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumFacilities)
      .where(and(...conditions))
      .orderBy(desc(crematoriumFacilities.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crematoriumFacilities)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertFacility(tx: ScopedTx, row: FacilityInsert): Promise<void> {
  await tx.insert(crematoriumFacilities).values(row);
}

export async function updateFacility(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  data: Partial<Pick<FacilityInsert, "facilityName" | "operatingHours" | "contactPerson" | "contactPhone" | "status" | "totalSlots">>,
  updatedBy: string,
): Promise<FacilityRow | null> {
  const result = await tx.update(crematoriumFacilities)
    .set({
      ...data,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${crematoriumFacilities.version} + 1`,
    })
    .where(and(eq(crematoriumFacilities.id, id), eq(crematoriumFacilities.tenantId, tenantId)))
    .returning();
  // Full row (not just {id}) so the caller can prime the read cache with fresh data
  // instead of leaving a stale pre-update row cached for up to the cache's TTL.
  return result[0] ?? null;
}

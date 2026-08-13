import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { parkingFacilities, type FacilityRow, type FacilityInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<FacilityRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parkingFacilities)
      .where(and(eq(parkingFacilities.id, id), eq(parkingFacilities.tenantId, tenantId)))
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

  const conditions = [eq(parkingFacilities.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(parkingFacilities.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(parkingFacilities)
      .where(and(...conditions))
      .orderBy(desc(parkingFacilities.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parkingFacilities)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertFacility(tx: ScopedTx, row: FacilityInsert): Promise<void> {
  await tx.insert(parkingFacilities).values(row);
}

export async function updateFacility(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  data: Partial<Pick<FacilityInsert, "facilityName" | "totalSpaces" | "availableSpaces" | "operatingHours" | "tariffPerHourMinor" | "tariffPerDayMinor" | "monthlyPassMinor" | "annualPassMinor" | "status" | "contactPerson">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(parkingFacilities)
    .set({
      ...data,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${parkingFacilities.version} + 1`,
    })
    .where(and(eq(parkingFacilities.id, id), eq(parkingFacilities.tenantId, tenantId)))
    .returning({ id: parkingFacilities.id });
  return result.length > 0;
}

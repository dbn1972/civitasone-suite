import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { marketProperties, type PropertyRow, type PropertyInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<PropertyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(marketProperties)
      .where(and(eq(marketProperties.id, id), eq(marketProperties.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; propertyType?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: PropertyRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(marketProperties.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(marketProperties.status, opts.status));
  if (opts.propertyType) conditions.push(eq(marketProperties.propertyType, opts.propertyType));

  const rows = await scopedRead((tx) =>
    tx.select().from(marketProperties)
      .where(and(...conditions))
      .orderBy(desc(marketProperties.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(marketProperties)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertProperty(tx: ScopedTx, row: PropertyInsert): Promise<void> {
  await tx.insert(marketProperties).values(row);
}

export async function updateProperty(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  data: Partial<Pick<PropertyInsert, "marketName" | "monthlyRentMinor" | "securityDepositMinor" | "status" | "area" | "areaUnit">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(marketProperties)
    .set({
      ...data,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${marketProperties.version} + 1`,
    })
    .where(and(eq(marketProperties.id, id), eq(marketProperties.tenantId, tenantId)))
    .returning({ id: marketProperties.id });
  return result.length > 0;
}

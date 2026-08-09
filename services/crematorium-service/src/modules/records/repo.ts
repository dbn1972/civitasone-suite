import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { crematoriumServiceRegister, type ServiceRegisterRow, type ServiceRegisterInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ServiceRegisterRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumServiceRegister)
      .where(and(eq(crematoriumServiceRegister.id, id), eq(crematoriumServiceRegister.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByFacility(
  facilityId: string,
  tenantId: string,
  opts: { page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: ServiceRegisterRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(crematoriumServiceRegister.tenantId, tenantId),
    eq(crematoriumServiceRegister.facilityId, facilityId),
  ];

  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumServiceRegister)
      .where(and(...conditions))
      .orderBy(desc(crematoriumServiceRegister.serviceDate))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crematoriumServiceRegister)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRecord(tx: ScopedTx, row: ServiceRegisterInsert): Promise<void> {
  await tx.insert(crematoriumServiceRegister).values(row);
}

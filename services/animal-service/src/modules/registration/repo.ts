import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { animalRegistrations, type RegistrationRow, type RegistrationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RegistrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(animalRegistrations)
      .where(and(eq(animalRegistrations.id, id), eq(animalRegistrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RegistrationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(animalRegistrations.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(animalRegistrations.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(animalRegistrations)
      .where(and(...conditions))
      .orderBy(desc(animalRegistrations.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(animalRegistrations)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRegistration(tx: ScopedTx, row: RegistrationInsert): Promise<void> {
  await tx.insert(animalRegistrations).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(animalRegistrations)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${animalRegistrations.version} + 1`,
    })
    .where(and(eq(animalRegistrations.id, id), eq(animalRegistrations.tenantId, tenantId)))
    .returning({ id: animalRegistrations.id });
  return result.length > 0;
}

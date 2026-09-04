import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { advApplications, type AdvApplicationRow, type AdvApplicationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AdvApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advApplications)
      .where(and(eq(advApplications.id, id), eq(advApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: AdvApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(advApplications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(advApplications.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(advApplications)
      .where(and(...conditions))
      .orderBy(desc(advApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(advApplications)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: AdvApplicationInsert): Promise<void> {
  await tx.insert(advApplications).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(advApplications)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(status === "submitted" ? { submittedAt: new Date() } : {}),
      version: sql`${advApplications.version} + 1`,
    })
    .where(and(eq(advApplications.id, id), eq(advApplications.tenantId, tenantId)))
    .returning({ id: advApplications.id });
  return result.length > 0;
}

// BUG FIX (collision-prone number generation): the caller used to compute
// `Date.now() % 999999` outside any lock and outside the write transaction —
// two commands processed close together produce the identical
// application_number, and the UNIQUE constraint on that column then throws
// inside the SECOND colliding consumer transaction (rolling back the whole
// write after the route already returned 202). nextval() on a real Postgres
// SEQUENCE is atomic and collision-free regardless of timing or replica
// count. See migrations/0003_number_sequences.sql.
export async function nextApplicationNumberSeq(tx: ScopedTx): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT nextval('adv_applications.application_number_seq') AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}

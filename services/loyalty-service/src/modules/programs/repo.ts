/**
 * programs/repo.ts — Database operations for loyalty programs.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { programs, type ProgramRow, type ProgramInsert } from "./schema.js";

export function toView(r: ProgramRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    status: r.status,
    earnRatio: r.earnRatio.toString(),
    expiryDays: r.expiryDays,
    tierConfig: r.tierConfig,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type ProgramView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<ProgramRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(programs).where(and(eq(programs.id, id), eq(programs.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ProgramRow[]; total: number }> {
  const where: SQL = eq(programs.tenantId, tenantId);

  const rows = await scopedRead((tx) =>
    tx.select().from(programs).where(where).orderBy(desc(programs.updatedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(programs).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: ProgramInsert): Promise<void> {
  await tx.insert(programs).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ProgramInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(programs)
    .set({ ...patch, updatedAt: new Date(), version: sql`${programs.version} + 1` })
    .where(and(eq(programs.id, id), eq(programs.tenantId, tenantId), eq(programs.version, currentVersion)))
    .returning({ id: programs.id });
  return result.length > 0;
}

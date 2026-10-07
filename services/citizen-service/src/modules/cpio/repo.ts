import { and, eq, ilike, or, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cpioDirectory, type CpioRow, type CpioInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** List/search active CPIOs for a tenant, optionally filtered by name/authority. */
export async function searchCpios(tenantId: string, q: string | undefined, limit: number): Promise<CpioRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => {
    const term = q && q.trim().length > 0 ? `%${q.trim()}%` : null;
    const where = term
      ? and(
          eq(cpioDirectory.tenantId, tenantId),
          eq(cpioDirectory.status, "active"),
          or(
            ilike(cpioDirectory.name, term),
            ilike(cpioDirectory.publicAuthority, term),
            ilike(cpioDirectory.department, term),
          ),
        )
      : and(eq(cpioDirectory.tenantId, tenantId), eq(cpioDirectory.status, "active"));
    return tx.select().from(cpioDirectory).where(where).orderBy(desc(cpioDirectory.updatedAt)).limit(limit);
  });
}

export async function findCpioById(tenantId: string, id: string): Promise<CpioRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(cpioDirectory)
    .where(and(eq(cpioDirectory.id, id), eq(cpioDirectory.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function insertCpio(tx: Writer, row: CpioInsert): Promise<void> {
  await tx.insert(cpioDirectory).values(row);
}

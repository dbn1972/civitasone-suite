import { eq, and, sql, ilike } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { clauseLibrary, type ClauseRow } from "./schema.js";

/** Execute a read within a tenant-scoped transaction (sets app.tenant_id GUC for RLS). */
async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

export async function findClauseById(id: string, tenantId: string): Promise<ClauseRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(clauseLibrary)
      .where(and(eq(clauseLibrary.id, id), eq(clauseLibrary.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listClauses(
  tenantId: string,
  opts: { limit: number; offset: number; category?: string; jurisdiction?: string },
): Promise<{ data: ClauseRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const conditions = [
      eq(clauseLibrary.tenantId, tenantId),
      eq(clauseLibrary.status, "active"),
    ];
    if (opts.category) {
      conditions.push(ilike(clauseLibrary.category, opts.category));
    }
    if (opts.jurisdiction) {
      conditions.push(ilike(clauseLibrary.jurisdiction, opts.jurisdiction));
    }

    const where = and(...conditions);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(clauseLibrary)
      .where(where);

    const data = await tx
      .select()
      .from(clauseLibrary)
      .where(where)
      .orderBy(clauseLibrary.createdAt)
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

export async function countClausesByTenant(tenantId: string): Promise<number> {
  return tenantRead(tenantId, async (tx) => {
    const [result] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(clauseLibrary)
      .where(eq(clauseLibrary.tenantId, tenantId));
    return result?.count ?? 0;
  });
}

export async function insertClause(clause: typeof clauseLibrary.$inferInsert): Promise<ClauseRow> {
  const [row] = await db.insert(clauseLibrary).values(clause).returning();
  return row!;
}

export async function updateClause(
  id: string,
  tenantId: string,
  currentVersion: number,
  updates: Partial<Pick<ClauseRow, "title" | "category" | "jurisdiction" | "body" | "mergeFields" | "status" | "updatedBy" | "updatedAt" | "version">>,
): Promise<ClauseRow | undefined> {
  const [row] = await db
    .update(clauseLibrary)
    .set(updates)
    .where(
      and(
        eq(clauseLibrary.id, id),
        eq(clauseLibrary.tenantId, tenantId),
        eq(clauseLibrary.version, currentVersion),
      ),
    )
    .returning();
  return row;
}

export async function archiveClause(
  id: string,
  tenantId: string,
  currentVersion: number,
  actorId: string,
): Promise<ClauseRow | undefined> {
  const [row] = await db
    .update(clauseLibrary)
    .set({
      status: "archived",
      updatedBy: actorId,
      updatedAt: new Date(),
      version: currentVersion + 1,
    })
    .where(
      and(
        eq(clauseLibrary.id, id),
        eq(clauseLibrary.tenantId, tenantId),
        eq(clauseLibrary.version, currentVersion),
      ),
    )
    .returning();
  return row;
}

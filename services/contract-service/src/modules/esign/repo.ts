import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { esignRoutes, type EsignRouteRow, type EsignRouteInsert, type SignatoryEntry } from "./schema.js";

async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

export async function insertEsignRoute(route: EsignRouteInsert): Promise<EsignRouteRow> {
  return tenantRead(route.tenantId, async (tx) => {
    const [row] = await tx.insert(esignRoutes).values(route).returning();
    return row!;
  });
}

export async function getEsignRouteById(id: string, tenantId: string): Promise<EsignRouteRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(esignRoutes)
      .where(and(eq(esignRoutes.id, id), eq(esignRoutes.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function updateEsignRoute(
  id: string,
  tenantId: string,
  currentVersion: number,
  updates: {
    signatories?: SignatoryEntry[];
    currentOrdinal?: number;
    status?: string;
    updatedBy: string;
  },
): Promise<EsignRouteRow | null> {
  return tenantRead(tenantId, async (tx) => {
    const setClause: Record<string, unknown> = {
      version: currentVersion + 1,
      updatedAt: new Date(),
      updatedBy: updates.updatedBy,
    };
    if (updates.signatories !== undefined) setClause.signatories = updates.signatories;
    if (updates.currentOrdinal !== undefined) setClause.currentOrdinal = updates.currentOrdinal;
    if (updates.status !== undefined) setClause.status = updates.status;

    const [row] = await tx
      .update(esignRoutes)
      .set(setClause)
      .where(
        and(
          eq(esignRoutes.id, id),
          eq(esignRoutes.tenantId, tenantId),
          eq(esignRoutes.version, currentVersion),
        ),
      )
      .returning();
    return row ?? null;
  });
}

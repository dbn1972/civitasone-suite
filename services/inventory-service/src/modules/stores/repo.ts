import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { stores, type StoreInsert, type StoreRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertStore(tx: Writer, row: StoreInsert): Promise<void> {
  await tx.insert(stores).values(row);
}

export async function findStore(tenantId: string, id: string): Promise<StoreRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(stores)
    .where(and(eq(stores.id, id), eq(stores.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listStores(tenantId: string, limit: number, offset: number): Promise<StoreRow[]> {
  return scopedRead((tx) => tx.select().from(stores)
    .where(eq(stores.tenantId, tenantId))
    .limit(limit).offset(offset));
}

export async function updateStore(
  id: string,
  tenantId: string,
  patch: Partial<Omit<StoreInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  actorId: string,
): Promise<StoreRow | null> {
  // Wrap in db.transaction() so wrapWithTenantGuc sets app.tenant_id GUC (required by FORCE RLS).
  const rows = await db.transaction(async (tx) =>
    (tx as unknown as typeof db).update(stores)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: sql`${stores.version} + 1` })
      .where(and(eq(stores.id, id), eq(stores.tenantId, tenantId)))
      .returning(),
  );
  return rows[0] ?? null;
}


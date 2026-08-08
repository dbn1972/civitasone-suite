import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { domainPacks, servicePacks, type ServicePackRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listDomainPacks(tenantId: string, limit = 50) {
  return db.transaction((tx) =>
    tx.select().from(domainPacks)
      .where(eq(domainPacks.tenantId, tenantId))
      .orderBy(desc(domainPacks.version))
      .limit(limit),
  );
}

export async function listServicePacks(tenantId: string, domainPackKey?: string, limit = 100) {
  return db.transaction((tx) =>
    tx.select().from(servicePacks)
      .where(domainPackKey
        ? and(eq(servicePacks.tenantId, tenantId), eq(servicePacks.domainPackKey, domainPackKey))
        : eq(servicePacks.tenantId, tenantId))
      .orderBy(desc(servicePacks.version))
      .limit(limit),
  );
}

export async function findServicePackById(id: string, tenantId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(servicePacks)
      .where(and(eq(servicePacks.id, id), eq(servicePacks.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function findServicePackByIdTx(tx: Writer, id: string, tenantId: string): Promise<ServicePackRow | null> {
  const rows = await (tx as typeof db).select().from(servicePacks)
    .where(and(eq(servicePacks.id, id), eq(servicePacks.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Latest version for (tenant, pack_key) or 0 when none exist. */
export async function latestVersionForPackKey(tx: Writer, tenantId: string, packKey: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(servicePacks)
    .where(and(eq(servicePacks.tenantId, tenantId), eq(servicePacks.packKey, packKey)))
    .orderBy(desc(servicePacks.version))
    .limit(1);
  return rows[0]?.version ?? 0;
}

export async function insertServicePack(
  tx: Writer,
  row: typeof servicePacks.$inferInsert,
): Promise<void> {
  await tx.insert(servicePacks).values(row);
}

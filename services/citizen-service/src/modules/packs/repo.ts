import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { domainPacks, servicePacks } from "./schema.js";

export async function listDomainPacks(tenantId: string, limit = 50) {
  return db.transaction((tx) =>
    tx.select().from(domainPacks)
      .where(eq(domainPacks.tenantId, tenantId))
      .orderBy(desc(domainPacks.version))
      .limit(limit),
  );
}

export async function findDomainPackByKey(tenantId: string, domainPackKey: string) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(domainPacks)
      .where(and(eq(domainPacks.tenantId, tenantId), eq(domainPacks.domainPackKey, domainPackKey)))
      .orderBy(desc(domainPacks.version))
      .limit(1);
    return rows[0] ?? null;
  });
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

export async function findServicePackByIdTx(
  tx: { select: typeof db.select },
  id: string,
  tenantId: string,
) {
  const rows = await (tx as typeof db).select().from(servicePacks)
    .where(and(eq(servicePacks.id, id), eq(servicePacks.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findServicePackById(id: string, tenantId: string) {
  return db.transaction((tx) => findServicePackByIdTx(tx, id, tenantId));
}

export async function findServicePacksByKeys(
  tenantId: string,
  domainPackKey: string,
  packKeys: string[],
) {
  if (packKeys.length === 0) return [];
  return db.transaction((tx) =>
    tx.select().from(servicePacks)
      .where(and(
        eq(servicePacks.tenantId, tenantId),
        eq(servicePacks.domainPackKey, domainPackKey),
        inArray(servicePacks.packKey, packKeys),
      ))
      .orderBy(desc(servicePacks.version)),
  );
}

import { eq, and, desc } from "drizzle-orm";
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

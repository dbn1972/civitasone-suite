import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { dscConfig, type DscConfigRow, type DscConfigInsert } from "./schema.js";

const CACHE_RESOURCE = "dsc_config";

export async function findByTenantId(tenantId: string): Promise<DscConfigRow | null> {
  return cache.getOrLoad<DscConfigRow | null>(
    cache.makeKey(tenantId, CACHE_RESOURCE, tenantId),
    async () => {
      const rows = await scopedRead((tx) => tx.select().from(dscConfig)
        .where(eq(dscConfig.tenantId, tenantId))
        .limit(1));
      return rows[0] ?? null;
    },
  ) as Promise<DscConfigRow | null>;
}

export async function upsert(tenantId: string, data: DscConfigInsert): Promise<void> {
  await db.insert(dscConfig).values({ ...data, tenantId }).onConflictDoUpdate({
    target: dscConfig.tenantId,
    set: {
      storageRef: data.storageRef,
      passphrase: data.passphrase,
      subjectCn: data.subjectCn,
      serialNumber: data.serialNumber,
      notBefore: data.notBefore,
      notAfter: data.notAfter,
      sha256Fingerprint: data.sha256Fingerprint,
      updatedAt: new Date(),
      updatedBy: data.updatedBy,
    },
  });
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, tenantId));
}

export async function remove(tenantId: string): Promise<void> {
  await db.delete(dscConfig).where(eq(dscConfig.tenantId, tenantId));
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, tenantId));
}

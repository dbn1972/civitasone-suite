import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { sponsorBankConfig, type SponsorBankConfigRow, type SponsorBankConfigInsert } from "./schema.js";

const CACHE_RESOURCE = "sponsor_bank_config";

export async function findByTenantId(tenantId: string): Promise<SponsorBankConfigRow | null> {
  return cache.getOrLoad<SponsorBankConfigRow | null>(
    cache.makeKey(tenantId, CACHE_RESOURCE, tenantId),
    async () => {
      const rows = await db.select().from(sponsorBankConfig)
        .where(eq(sponsorBankConfig.tenantId, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },
  ) as Promise<SponsorBankConfigRow | null>;
}

export async function upsert(tenantId: string, data: SponsorBankConfigInsert): Promise<void> {
  await db.insert(sponsorBankConfig).values({ ...data, tenantId }).onConflictDoUpdate({
    target: sponsorBankConfig.tenantId,
    set: {
      sponsorCode: data.sponsorCode,
      sponsorIfsc: data.sponsorIfsc,
      sponsorAccount: data.sponsorAccount,
      utilityCode: data.utilityCode ?? null,
      userNumber: data.userNumber ?? null,
      settlementOffsetDays: data.settlementOffsetDays ?? 1,
      nachEnabled: data.nachEnabled ?? true,
      apbsEnabled: data.apbsEnabled ?? false,
      maxRecordsPerFile: data.maxRecordsPerFile ?? 100000,
      maxAmountPerFileMinor: data.maxAmountPerFileMinor ?? 1000000000n,
      updatedAt: new Date(),
      updatedBy: data.updatedBy,
    },
  });
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, tenantId));
}

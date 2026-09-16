import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { tradeLicenses } from "./schema.js";
import { eq, and } from "drizzle-orm";

const SERVICE = "revenue";

export async function findTradeLicense(tenantId: string, id: string) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:trade_license:${id}`, async () =>
    tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(tradeLicenses).where(and(eq(tradeLicenses.tenantId, tenantId), eq(tradeLicenses.id, id)));
    })
  );
  return rows?.[0] ?? null;
}

export async function listTradeLicenses(tenantId: string, p: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:trade_licenses`, async () =>
    tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      // ORDER BY is required, not cosmetic: pagination slices this result
      // in-memory below, and without a deterministic order Postgres is free
      // to return rows in a different sequence on every query (or cache
      // refill), so which 100 records land on "page 1" would not be stable.
      // businessName is the primary lookup key in the mobile/web UI search
      // box; `id` breaks ties between same-named businesses.
      return t
        .select()
        .from(tradeLicenses)
        .where(eq(tradeLicenses.tenantId, tenantId))
        .orderBy(tradeLicenses.businessName, tradeLicenses.id);
    })
  );
  const all = rows ?? [];
  return {
    data: all.slice(p.offset, p.offset + p.limit),
    meta: { page: Math.floor(p.offset / p.limit) + 1, pageSize: p.limit, total: all.length },
  };
}

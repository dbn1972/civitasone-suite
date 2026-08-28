import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { instalmentPlans, writeOffs } from "./schema.js";
import { eq, and, desc } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function listInstalmentPlans(
  tenantId: string,
  assesseeId: string,
  pagination: { limit: number; offset: number },
) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:instalments:${assesseeId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(instalmentPlans)
        .where(and(eq(instalmentPlans.tenantId, tenantId), eq(instalmentPlans.assesseeId, assesseeId)))
        .orderBy(desc(instalmentPlans.createdAt));
    });
  });
  return rows ?? [];
}

/**
 * Fetch a single write-off by id, tenant-scoped. Used by the maker-checker
 * decide screen so a checker never approves/rejects blind — the caller
 * needs amountMinor + the reason + who raised it before deciding.
 */
export async function findWriteOffById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(writeOffs)
      .where(and(eq(writeOffs.tenantId, tenantId), eq(writeOffs.id, id)))
      .limit(1);
  });
  return rows[0] ?? null;
}

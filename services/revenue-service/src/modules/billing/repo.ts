import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { bills } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function listBills(tenantId: string, assesseeId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:bills:${assesseeId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(bills).where(and(eq(bills.tenantId, tenantId), eq(bills.assesseeId, assesseeId)));
    });
  }) ?? [];
  return {
    data: rows.slice(pagination.offset, pagination.offset + pagination.limit),
    total: rows.length,
  };
}

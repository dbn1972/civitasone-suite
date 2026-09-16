import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { assessees } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function findAssessee(tenantId: string, id: string) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessee:${id}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(assessees)
        .where(and(eq(assessees.tenantId, tenantId), eq(assessees.id, id)));
    });
  });
  return rows?.[0] ?? null;
}

export async function listAssessees(tenantId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessees`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      // ORDER BY needed for the same reason as trade-license's listing (see
      // that module's repo.ts): pagination slices this result in-memory, so
      // without a deterministic order the page boundaries aren't stable.
      // ownerName mirrors the mobile/web lookup-by-name UI; `id` breaks ties.
      return t
        .select()
        .from(assessees)
        .where(eq(assessees.tenantId, tenantId))
        .orderBy(assessees.ownerName, assessees.id);
    });
  });
  const all = rows ?? [];
  const total = all.length;
  const data = all.slice(pagination.offset, pagination.offset + pagination.limit);
  return { data, meta: { page: Math.floor(pagination.offset / pagination.limit) + 1, pageSize: pagination.limit, total } };
}

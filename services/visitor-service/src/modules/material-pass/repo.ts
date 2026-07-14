/**
 * visitor-service: material-pass reads.
 *
 * Read-through via `cache.getOrLoad` for single-entity lookup (GET /:passId).
 * Lists are filtered by tenant and pass ID since material passes are
 * per-visit-pass records (one batch per check-in event).
 *
 * Requirement 13.5: searchable log of Material_Pass records for audit.
 */
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { materialPasses, type MaterialPassRow } from "./schema.js";

const RESOURCE = "material_pass";

/**
 * `visitor:{tenant}:material_pass:{passId}` — returns all material-pass
 * item rows for the given digital pass. Cached with default TTL.
 */
export async function getMaterialPassesByPassId(tenantId: string, passId: string): Promise<MaterialPassRow[]> {
  const result = await cache.getOrLoad<MaterialPassRow[]>(cache.makeKey(tenantId, RESOURCE, passId), async () => {
    return scopedRead((tx) => tx.select().from(materialPasses)
      .where(and(eq(materialPasses.passId, passId), eq(materialPasses.tenantId, tenantId))));
  });
  return result ?? [];
}

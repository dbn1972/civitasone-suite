/**
 * visitor-service: digital-pass reads.
 *
 * Single-pass lookup uses `cache.getOrLoad` with key
 * `visitor:{tenantId}:pass:{id}` and a 5-minute TTL (Requirement 4.5, 4.6).
 * Writes go through CQRS command publishers in `./commands.ts` — this file
 * is read-only.
 */
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { digitalPasses, type DigitalPassRow } from "./schema.js";

const RESOURCE_PASS = "pass";
const PASS_TTL_SECONDS = 300; // 5 minutes

/**
 * `visitor:{tenantId}:pass:{id}` — cache.getOrLoad read-through (TTL 5m).
 * Returns null (and does not cache) when the pass does not exist or belongs
 * to another tenant. Used by GET /:id and the revoke/replace routes to 404
 * before publishing.
 */
export async function getPassById(tenantId: string, id: string): Promise<DigitalPassRow | null> {
  return cache.getOrLoad<DigitalPassRow>(
    cache.makeKey(tenantId, RESOURCE_PASS, id),
    async () => {
      const rows = await scopedRead((tx) => tx.select().from(digitalPasses)
        .where(and(eq(digitalPasses.id, id), eq(digitalPasses.tenantId, tenantId))));
      return rows[0] ?? null;
    },
    PASS_TTL_SECONDS,
  );
}

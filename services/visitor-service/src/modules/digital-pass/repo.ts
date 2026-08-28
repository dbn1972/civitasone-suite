/**
 * visitor-service: digital-pass reads.
 *
 * Single-pass lookup uses `cache.getOrLoad` with key
 * `visitor:{tenantId}:pass:{id}` and a 5-minute TTL (Requirement 4.5, 4.6).
 * Writes go through CQRS command publishers in `./commands.ts` — this file
 * is read-only.
 */
import { and, eq, inArray } from "drizzle-orm";
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

/**
 * IDs of passes for `visitRequestId` that are still in a state where
 * they could be scanned/used (not already checked_out/revoked/expired).
 * Used by visit-request/consumer.ts's cancellation cascade — deliberately
 * NOT a cache.getOrLoad read (this drives a one-shot revoke, a stale hit
 * would skip revoking a pass that just became active).
 */
export async function listRevocablePassIdsByVisitRequest(
  tenantId: string,
  visitRequestId: string,
): Promise<string[]> {
  const rows = await scopedRead((tx) => tx
    .select({ id: digitalPasses.id })
    .from(digitalPasses)
    .where(
      and(
        eq(digitalPasses.visitRequestId, visitRequestId),
        eq(digitalPasses.tenantId, tenantId),
        inArray(digitalPasses.status, ["active", "checked_in", "checked_out"]),
      ),
    ));
  return rows.map((r) => r.id);
}

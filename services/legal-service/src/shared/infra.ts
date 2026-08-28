import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = createQueue();

/**
 * Post-write cache invalidation: one single-item key plus one or more
 * plural list-cache resources. Introduced by fix/legal-stale-list-cache-fleet
 * to close out cases/opinions/hearings/filings/rti/eoffice-consumer all
 * hand-copying `Promise.all([cache.invalidate(cache.makeKey(...)),
 * cache.invalidateResource(...)])` — review on that PR flagged the
 * duplication as a typo risk (reusing the wrong resource string at any one
 * of the ~10 call sites would silently reintroduce the exact stale-list-cache
 * bug the PR exists to fix) and noted that hearings/consumer.ts's
 * hearingCreate and hearingAdjourn had *already* drifted from each other
 * once during that same PR's own review cycle. This is the single
 * choke-point going forward — pass `item: null` for a module with no real
 * per-item cache (e.g. rti, where getApplication()/listDisclosures() never
 * go through the cache at all).
 */
export async function invalidateItemAndLists(
  tenantId: string,
  item: { resource: string; id: string } | null,
  listResources: string[],
): Promise<void> {
  const ops: Promise<void>[] = listResources.map((resource) => cache.invalidateResource(tenantId, resource));
  if (item) ops.push(cache.invalidate(cache.makeKey(tenantId, item.resource, item.id)));
  await Promise.all(ops);
}

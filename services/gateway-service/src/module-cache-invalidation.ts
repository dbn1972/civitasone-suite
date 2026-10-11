/**
 * Gateway worker consumer that keeps the module-guard cache fresh (ST-M01-02).
 *
 * The module-guard caches a tenant's effective allow-list + enforcement mode for
 * CACHE_TTL_MS (60s). When an operator toggles a module (admin.module.toggle) or
 * changes a tenant's composition/enforcement, that cache must drop promptly so a
 * newly-disabled module is enforced without waiting out the TTL — otherwise a
 * disabled module stays reachable (or a re-enabled one stays blocked) for up to
 * a minute. This subscribes the gateway to the EXISTING admin module-toggle
 * event path and calls invalidateModuleCache for the affected tenant.
 *
 * Deliberately reuses the existing `admin.module.toggle` topic rather than
 * minting a new event: no new contract, no new topic surface, and the toggle is
 * precisely the signal that invalidates the cache. The gateway subscriber is a
 * pure cache-drop — it performs no DB write and no outbox enqueue, so it needs
 * no transaction, no markProcessed, and no audit (the admin consumer already
 * owns the write + audit for the same message).
 */
import type { Queue } from "@civitasone/queue";
import { invalidateModuleCache } from "./module-guard.js";

/** The admin-owned command topic that signals a tenant's module set changed. */
export const MODULE_TOGGLE_TOPIC = "admin.module.toggle";
/** The admin-owned composition applier topic (ST-M01-03) — also changes the set. */
export const COMPOSITION_APPLY_TOPIC = "admin.composition.apply_plan";

type ModuleTogglePayload = { tenantId: string };

/**
 * Register the module-guard cache-invalidation consumer on the gateway worker's
 * queue. Idempotent and side-effect-free beyond clearing the in-process cache.
 */
export function registerModuleCacheInvalidation(queue: Queue): void {
  const handler = async (msg: { payload?: ModuleTogglePayload; tenantId?: string }): Promise<void> => {
    const tenantId = msg.payload?.tenantId ?? msg.tenantId;
    if (typeof tenantId === "string" && tenantId.length > 0) {
      invalidateModuleCache(tenantId);
    }
  };
  queue.subscribe<ModuleTogglePayload>(MODULE_TOGGLE_TOPIC, handler);
  queue.subscribe<ModuleTogglePayload>(COMPOSITION_APPLY_TOPIC, handler);
}

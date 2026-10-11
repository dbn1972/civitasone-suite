/**
 * Module-guard cache invalidation for the gateway-worker (ST-M01-02).
 *
 * The module-guard cache (`moduleCache` / `lastKnownMode`) lives in the memory of
 * the gateway HTTP app process (PM2 `gateway`); queue consumers run in the
 * separate PM2 `gateway-worker` process, and the queue delivers each message to
 * ONE consumer (competing consumers). So this consumer cannot clear the cache
 * itself: it subscribes to the post-commit `admin.composition.enforcement_mode_changed`
 * outbox event (admin-service is its only producer; nothing else consumes it) and
 * forwards the invalidation to the app process over its authenticated internal
 * endpoint, POST /internal/module-cache/invalidate.
 *
 * The admin command topics (admin.module.toggle, admin.composition.apply_plan)
 * are consumed by admin-service itself, so the gateway cannot subscribe to them;
 * admin-service calls the same endpoint after its own commit
 * (admin-service/src/module-cache-notify.ts).
 *
 * Best-effort: a failed call is logged and the 60s CACHE_TTL_MS in module-guard.ts
 * remains the staleness bound.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { CONSUMED_EVENTS } from "./topics.js";

const log = pino({ name: "gateway-module-cache-invalidation" });

/** Post-commit event published when a tenant's enforcement mode changes. */
export const ENFORCEMENT_MODE_CHANGED_TOPIC = CONSUMED_EVENTS.compositionEnforcementModeChanged;

export type InvalidateGatewayCache = (tenantId: string) => Promise<void>;

/** POST the tenant id to the gateway app's internal invalidation endpoint. */
export const invalidateViaGatewayApp: InvalidateGatewayCache = async (tenantId) => {
  const base = process.env.GATEWAY_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
  const res = await fetch(`${base}/internal/module-cache/invalidate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "" },
    body: JSON.stringify({ tenantId }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`gateway invalidate returned ${res.status}`);
};

type ModeChangedPayload = { tenantId: string };

export function registerModuleCacheInvalidation(
  queue: Queue,
  invalidate: InvalidateGatewayCache = invalidateViaGatewayApp,
): void {
  queue.subscribe<ModeChangedPayload>(ENFORCEMENT_MODE_CHANGED_TOPIC, async (msg) => {
    const tenantId = msg.payload?.tenantId ?? msg.tenantId;
    if (typeof tenantId !== "string" || tenantId.length === 0) return;
    try {
      await invalidate(tenantId);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "module-cache invalidate failed; 60s TTL bounds staleness");
    }
  });
}

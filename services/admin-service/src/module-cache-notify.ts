/**
 * Tell the gateway app to drop its module-guard cache for a tenant (ST-M01-02).
 *
 * The cache lives in the gateway HTTP app process, so admin-service reaches it
 * over the same authenticated internal channel as /internal/config. Call AFTER
 * the transaction commits. Best-effort and never throws: on failure the gateway's
 * 60s cache TTL is the staleness bound.
 */
import { pino } from "pino";

const log = pino({ name: "admin-module-cache-notify" });

export async function notifyGatewayModuleCache(tenantId: string): Promise<void> {
  const base = process.env.GATEWAY_INTERNAL_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";
  try {
    const res = await fetch(`${base}/internal/module-cache/invalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "" },
      body: JSON.stringify({ tenantId }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) log.warn({ tenantId, status: res.status }, "gateway module-cache invalidate refused; 60s TTL bounds staleness");
  } catch (err) {
    log.warn({ tenantId, err: err instanceof Error ? err.message : String(err) }, "gateway module-cache invalidate failed; 60s TTL bounds staleness");
  }
}

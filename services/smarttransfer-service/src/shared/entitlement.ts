/**
 * In-service entitlement re-check (defence in depth; M00 standalone §5 item 6,
 * spec §11.5/§14).
 *
 * This is NEW code INSIDE smarttransfer-service. It does NOT touch the gateway's
 * fail-open/closed semantics (BLOCKED on the owner, evidence/M01/ST-M01-02/
 * STOP_AND_ASK.md): the gateway keeps its own behaviour. This guard refuses any
 * request for a tenant where the `smarttransfer` module is not enabled, and it
 * FAILS CLOSED — a missing tenant, an unreachable admin-service, an open
 * breaker, or a composition projection that does not list `smarttransfer` all
 * DENY. Failing closed is the correct default for a brand-new service: there is
 * no legacy tenant that could be black-holed (no SmartTransfer tenant predates
 * this service), so none of the gateway#986 legacy-tenant concerns apply here.
 *
 * The projection is read through the existing admin composition client/getOrLoad
 * pattern (same endpoint the gateway module-guard uses:
 * GET /v1/admin/composition/internal/:tenantId/modules), cached per tenant via
 * the shared read-through Cache so the hot path is one Redis lookup.
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import type { RequestContext } from "@civitasone/types";
import { cache } from "./infra.js";
import { HttpError } from "./context.js";
import { MODULE_KEY, SERVICE } from "../topics.js";

const entitlementBreaker = new CircuitBreaker({
  name: "smarttransfer-entitlement-admin",
  failureThreshold: 3,
  recoveryMs: 10_000,
});

/** How long an enablement decision is cached (seconds). */
const ENTITLEMENT_TTL_SECONDS = 30;

/**
 * Fetch the composition projection for a tenant and decide whether
 * `smarttransfer` is enabled. Returns a boolean; never throws — the caller
 * turns a false (or a thrown fetch error → false) into a 403. Fails CLOSED:
 *   - admin reachable, `configured:true`, list contains `smarttransfer` → true
 *   - admin reachable, `configured:false` (tenant never onboarded)        → false
 *   - admin reachable, list lacks `smarttransfer`                         → false
 *   - admin unreachable / breaker open / non-2xx / timeout                → false
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchEnabled(tenantId: string): Promise<boolean> {
  // A tenant id that is not a UUID never reaches the URL (fail CLOSED), and the
  // value is path-encoded, so it can only address the composition endpoint.
  if (!UUID_RE.test(tenantId)) return false;
  const adminUrl = process.env.GATEWAY_ADMIN_URL ?? "http://127.0.0.1:3022";
  const url = `${adminUrl}/v1/admin/composition/internal/${encodeURIComponent(tenantId)}/modules`;
  const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
  const headers: Record<string, string> = {
    "x-internal": "1",
    "x-tenant-id": tenantId,
    "x-service-secret": secret,
    "x-internal-caller": `${SERVICE}-entitlement`,
  };
  try {
    const body = await entitlementBreaker.call(async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`admin-service ${res.status}`);
      return (await res.json()) as { configured?: boolean; data?: Array<{ name: string }> };
    });
    // configured:false means the tenant never onboarded. Unlike the gateway's
    // legacy fail-OPEN safeguard, this NEW service fails CLOSED on it.
    if (body.configured === false) return false;
    const modules = new Set((body.data ?? []).map((m) => m.name));
    return modules.has(MODULE_KEY);
  } catch (err) {
    // Breaker open, timeout, non-2xx, or network error → fail CLOSED.
    if (err instanceof CircuitBreakerOpenError) return false;
    return false;
  }
}

/**
 * Guard a request: throw 403 MODULE_NOT_ENTITLED unless `smarttransfer` is
 * enabled for the caller's tenant. The tenant comes from the SERVER context
 * (ctx.tenantId), never from a client id. Cached per tenant for a short TTL.
 */
export async function requireSmartTransferEntitlement(ctx: RequestContext): Promise<void> {
  if (!ctx.tenantId || !UUID_RE.test(ctx.tenantId)) {
    // No (or a malformed) tenant context → fail CLOSED.
    throw new HttpError(403, "MODULE_NOT_ENTITLED", "SmartTransfer is not enabled for this tenant");
  }
  const key = cache.makeKey(ctx.tenantId, "entitlement", MODULE_KEY);
  const enabled = await cache.getOrLoad(
    key,
    () => fetchEnabled(ctx.tenantId),
    ENTITLEMENT_TTL_SECONDS,
  );
  if (!enabled) {
    throw new HttpError(403, "MODULE_NOT_ENTITLED", "SmartTransfer is not enabled for this tenant");
  }
}

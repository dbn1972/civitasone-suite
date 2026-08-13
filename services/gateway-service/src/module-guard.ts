/**
 * Module guard middleware for the gateway.
 * Checks if the requested module is enabled for the tenant before proxying.
 *
 * Lookup: GET /v1/admin/tenant/modules (cached in Redis) to get enabled module keys.
 * If the target service's module is disabled → 403 MODULE_DISABLED.
 *
 * Module keys are derived from the route prefix (e.g., /api/v1/finance → "finance").
 *
 * TODO: Hook this into the proxy handler in app.ts once end-to-end testing is complete.
 *       Call `checkModuleEnabled(req, reply, resolved.route.name)` after resolveRoute()
 *       and before the upstream fetch. If it returns false, short-circuit (reply already sent).
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

const moduleGuardBreaker = new CircuitBreaker({
  name: "module-guard-admin",
  failureThreshold: 3,
  recoveryMs: 10_000,
});

/** Map route name to module key for enforcement */
const ROUTE_TO_MODULE: Record<string, string> = {
  finance: "finance",
  procurement: "procurement",
  hrms: "hrms",
  hr: "hrms",
  payroll: "payroll",
  project: "projects",
  projects: "projects",
  asset: "assets",
  assets: "assets",
  stock: "stock",
  grant: "grants",
  "grant-alias": "grants",
  citizen: "citizen",
  legal: "legal",
  crm: "crm",
  helpdesk: "helpdesk",
  telephony: "telephony",
  knowledge: "knowledge",
  documents: "documents",
  eoffice: "documents",
  workflow: "workflow",
  analytics: "analytics",
  ml: "analytics",
  meeting: "meeting",
  court: "court",
  courts: "court",
  visitor: "visitor",
  inspection: "inspection",
  billing: "billing",
  inventory: "inventory",
  reports: "reports",
  estab: "establishment",
  establishment: "establishment",
  contract: "contracts",
};

// Platform routes (always available, not module-gated)
const PLATFORM_ROUTES = new Set([
  "identity", "policy", "policy-v1", "audit-events", "audit",
  "notification", "notification-v1", "admin", "admin-users", "install", "plugin",
  "theme", "tenant", "tenant-singular", "sync", "devices", "queue", "locations",
]);

// In-memory module cache (TTL: 60s) per tenant
const moduleCache = new Map<string, { modules: Set<string>; expires: number }>();
const CACHE_TTL_MS = 60_000;

function extractTenantId(req: FastifyRequest): string | null {
  // Tenant ID comes from the JWT decoded by auth middleware (x-tenant-id header forwarded)
  return (req.headers["x-tenant-id"] as string) ?? null;
}

export async function checkModuleEnabled(
  req: FastifyRequest,
  reply: FastifyReply,
  routeName: string,
): Promise<boolean> {
  // Platform routes bypass module check
  if (PLATFORM_ROUTES.has(routeName)) return true;

  const moduleKey = ROUTE_TO_MODULE[routeName];
  if (!moduleKey) return true; // Unknown route → allow (conservative)

  const tenantId = extractTenantId(req);
  if (!tenantId) return true; // No tenant context → allow (auth will catch it)

  const enabledModules = await getEnabledModules(tenantId);
  if (!enabledModules) return true; // No config found → allow (tenant may be new)

  if (enabledModules.has(moduleKey)) return true;

  // Module disabled — reject
  reply.code(403).send({
    code: "MODULE_DISABLED",
    message: `Module '${moduleKey}' is not enabled for this tenant. Contact your administrator.`,
    correlationId: req.id,
    retryable: false,
  });
  return false;
}

async function getEnabledModules(tenantId: string): Promise<Set<string> | null> {
  const cached = moduleCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.modules;

  try {
    // Query admin-service directly (internal network), wrapped in circuit breaker.
    // When COMPOSITION_ENFORCEMENT=on, source the allow-list from the dependency-
    // resolved composition engine (org profile + hard-dep closure, projected to
    // gateway route-keys); otherwise keep the legacy config-based modules-list.
    const adminUrl = process.env.GATEWAY_ADMIN_URL ?? "http://127.0.0.1:3022";
    const useComposition = process.env.COMPOSITION_ENFORCEMENT === "on";
    const url = useComposition
      ? `${adminUrl}/v1/admin/composition/internal/${tenantId}/modules`
      : `${adminUrl}/v1/admin/tenants/${tenantId}/modules-list`;
    const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
    // The composition endpoint sits behind admin's global auth hook, whose
    // service-to-service contract is x-internal:1 + x-tenant-id + x-service-secret
    // (packages/auth/plugin.ts). The legacy modules-list path keeps its existing
    // header untouched so its (fail-open) behaviour is unchanged when the flag is off.
    const headers: Record<string, string> = useComposition
      ? { "x-internal": "1", "x-tenant-id": tenantId, "x-service-secret": secret, "x-internal-caller": "gateway-module-guard" }
      : { "x-internal-secret": secret };

    const body = await moduleGuardBreaker.call(async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`admin-service ${res.status}`);
      return (await res.json()) as { configured?: boolean; data: Array<{ name: string }> };
    });

    // Composition mode: a tenant that never onboarded is `configured:false` —
    // fail OPEN (null), never enforce an empty allow-list against it.
    if (useComposition && body.configured === false) return null;

    const modules = new Set<string>(body.data.map((m: { name: string }) => m.name));
    moduleCache.set(tenantId, { modules, expires: Date.now() + CACHE_TTL_MS });
    return modules;
  } catch (err) {
    // On failure (including CircuitBreakerOpenError), allow request — don't block on config service outage
    if (err instanceof CircuitBreakerOpenError) {
      // Circuit is open; fail-open to avoid blocking all requests
    }
    return null;
  }
}

/** Clear cache on toggle (called when admin-service publishes module.enablement.changed event) */
export function invalidateModuleCache(tenantId: string): void {
  moduleCache.delete(tenantId);
}

/** Exposed for testing — access to internals */
export const _test = {
  ROUTE_TO_MODULE,
  PLATFORM_ROUTES,
  moduleCache,
  CACHE_TTL_MS,
} as const;

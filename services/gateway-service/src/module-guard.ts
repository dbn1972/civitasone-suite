/**
 * Module guard middleware for the gateway (FF-03, ST-M01-02).
 *
 * SINGLE SOURCE OF TRUTH: module enablement comes from the admin-service
 * composition projection (GET /v1/admin/composition/internal/:tenantId/modules),
 * the same projection the web ModuleGate/nav reads (apps/web .../moduleVisibility.ts
 * → /v1/admin/composition/my-modules). The projection also carries the tenant's
 * EFFECTIVE enforcement `mode`.
 *
 * PER-TENANT ENFORCEMENT MODE (D-ST-24):
 *   • off     — the pre-FF-03 behaviour, fail OPEN on every ambiguous signal
 *               (unmapped route, missing tenant, admin outage / open breaker,
 *               configured:false). This is the default and preserves the
 *               gateway-service #986 legacy-tenant safeguard verbatim.
 *   • shadow  — compute the enforce-mode decision; if it WOULD deny, emit a
 *               would-deny log + metric, then ALLOW anyway (soak before flip).
 *   • enforce — fail CLOSED: a disabled module, an unmapped route, a missing
 *               tenant, an admin outage / open breaker, or configured:false all
 *               return 403. Public/health/auth + platform routes always pass.
 *
 * Legacy mode (COMPOSITION_ENFORCEMENT!="on") has no mode source, so the mode is
 * always `off`; behaviour there is byte-for-byte the pre-existing fail-open.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { pino } from "pino";

const log = pino({ name: "gateway-module-guard" });

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
  // Municipal Sec5 (17 services) - route name matches gateway registry.ts
  // "name" field exactly for each; module key mirrors that 1:1.
  shop: "shop",
  trade: "trade",
  building: "building",
  fire: "fire",
  advertisement: "advertisement",
  vendor: "vendor",
  roadcut: "roadcut",
  event: "event",
  refund: "refund",
  sewerage: "sewerage",
  swm: "swm",
  drainage: "drainage",
  parks: "parks",
  animal: "animal",
  crematorium: "crematorium",
  parking: "parking",
  market: "market",
  // SmartTransfer OS (ST-M01-12): gateway registry entry; module key
  // `smarttransfer`. Additive — no existing mapping or fail-open/closed
  // semantic is changed (those are BLOCKED on the owner, ST-M01-02). The
  // smarttransfer-service additionally re-checks entitlement in-process and
  // fails CLOSED (shared/entitlement.ts).
  smarttransfer: "smarttransfer",
};

// Platform routes — always available, NEVER module-gated, in EVERY mode
// (including enforce). These are the platform layer every tenant gets per the
// standalone SKU (SMARTTRANSFER-MASTER-SPEC-v3 §1: identity, tenant, gateway,
// admin, audit, notification, workflow, DOCUMENT, queue, policy) plus the
// edge-level auth/health/config/location surfaces. This is the "composition
// projection fix" of ST-M01-02: documents / eoffice (the eOffice document
// backend) and notification must stay reachable for a composed / standalone
// tenant and were previously module-gated via ROUTE_TO_MODULE, so they would
// have 403'd a standalone tenant whose projection does not include a
// `documents` route-key. Treating them as platform routes guarantees reach in
// every mode.
//
// D-101 note: this is not a security guard baseline/allow-list that suppresses
// a finding; it is the platform-service surface defined by spec §1. The entry
// is tracked by this ST-M01-02 change (decision D-ST-24, owner dbn1972,
// 2026-10-10) and the master spec §1 platform list; no expiry — it is the
// permanent definition of the always-on platform layer.
const PLATFORM_ROUTES = new Set([
  "identity", "policy", "policy-v1", "audit-events", "audit",
  "notification", "notification-v1", "admin", "admin-users", "install", "plugin",
  "theme", "tenant", "tenant-singular", "sync", "devices", "queue", "locations",
  // Platform document/eOffice backend (spec §1 — "document" is platform).
  "documents", "eoffice",
  // Platform location sub-routes that share the location upstream with "locations".
  "geofences", "jurisdictions", "hierarchy", "pincodes",
]);

type EnforcementMode = "off" | "shadow" | "enforce";

// In-memory module cache (TTL: 60s) per tenant — now also carries the tenant's
// effective enforcement mode so the decision and the mode come from one fetch.
// `outage` is true when the allow-list is unknown because admin-service could not
// be reached (vs. a reachable admin reporting configured:false).
type CacheEntry = { modules: Set<string> | null; mode: EnforcementMode; configured: boolean; expires: number; outage?: boolean };
const moduleCache = new Map<string, CacheEntry>();
// This cache is per gateway HTTP app process and is NOT invalidated by the
// queue-driven gateway worker (a separate process). A module toggle, composition
// change or enforcement-mode flip therefore takes effect on a gateway instance
// within CACHE_TTL_MS (60s) at most - that TTL is the documented staleness bound.
const CACHE_TTL_MS = 60_000;

// Last-known enforcement mode per tenant, retained BEYOND the module cache TTL.
// This is what lets an admin-service outage still fail CLOSED for a tenant we
// have ever seen as `enforce`: the module allow-list is unknown during an
// outage, but the tenant's INTENT (enforce) is sticky, so we must not silently
// fall back to fail-open for it. Cleared only by invalidateModuleCache (reached
// via POST /internal/module-cache/invalidate); otherwise it is overwritten by
// the next successful fetch (so never staler than CACHE_TTL_MS while admin is
// up). Bounded by the tenant count (one small string per tenant); fail-closed
// safety outweighs the memory.
const lastKnownMode = new Map<string, EnforcementMode>();

// would-deny counter for shadow mode (ops visibility; a Prometheus counter is
// scraped from /metrics by response-metrics.ts in a follow-up — here we keep a
// process-local tally and a structured log line so the soak is observable now).
let shadowWouldDenyCount = 0;

function extractTenantId(req: FastifyRequest): string | null {
  // Tenant ID comes from the JWT decoded by auth middleware (x-tenant-id header forwarded)
  return (req.headers["x-tenant-id"] as string) ?? null;
}

/**
 * enforce + admin-service unreachable: the guard cannot decide, so it fails
 * CLOSED — but as a distinct, retryable 503, not a "module disabled" 403. A
 * client/operator must be able to tell an admin outage from a licensing denial.
 */
function sendGuardUnavailable(req: FastifyRequest, reply: FastifyReply): false {
  reply.header("retry-after", "5").code(503).send({
    code: "MODULE_GUARD_UNAVAILABLE",
    message: "Module entitlement could not be verified right now. Please retry shortly.",
    correlationId: req.id,
    retryable: true,
  });
  return false;
}

function sendModuleDisabled(req: FastifyRequest, reply: FastifyReply, moduleKey: string): false {
  reply.code(403).send({
    code: "MODULE_DISABLED",
    message: `Module '${moduleKey}' is not enabled for this tenant. Contact your administrator.`,
    correlationId: req.id,
    retryable: false,
  });
  return false;
}

/**
 * Decide whether a request may proceed, honouring the tenant's enforcement mode.
 *
 * Returns true to allow (reply untouched); false after sending a 403 to deny.
 */
export async function checkModuleEnabled(
  req: FastifyRequest,
  reply: FastifyReply,
  routeName: string,
): Promise<boolean> {
  // Platform routes bypass the module check in EVERY mode.
  if (PLATFORM_ROUTES.has(routeName)) return true;

  const moduleKey = ROUTE_TO_MODULE[routeName];
  const tenantId = extractTenantId(req);
  const useComposition = process.env.COMPOSITION_ENFORCEMENT === "on";

  // Legacy (non-composition) deployments have NO enforcement-mode source, so
  // the effective mode is always `off`. In that case an unmapped route or a
  // missing tenant short-circuits to ALLOW WITHOUT contacting admin-service —
  // byte-for-byte the pre-FF-03 behaviour (no fetch for these bypass paths).
  // Only composition mode consults the projection for these ambiguous cases,
  // because only there can a tenant be `enforce`.
  if (!useComposition) {
    if (!moduleKey) return true; // unknown route → allow (conservative), no fetch
    if (!tenantId) return true; // no tenant context → allow (auth will catch), no fetch
  }

  // Resolve the tenant's effective mode + allow-list. With no tenant we cannot
  // look one up; the mode is therefore `off` by definition (allows below).
  const resolved = tenantId ? await getEnabled(tenantId) : null;
  const mode: EnforcementMode = resolved?.mode ?? "off";

  // ── unmapped route ───────────────────────────────────────────────────────
  if (!moduleKey) {
    // off/shadow: allow (shadow records the would-deny). enforce: fail closed.
    if (mode === "enforce") return sendModuleDisabled(req, reply, routeName);
    if (mode === "shadow") recordWouldDeny(req, routeName, "unmapped_route");
    return true;
  }

  // ── missing tenant context ─────────────────────────────────────────────────
  if (!tenantId) {
    // Composition mode (the only mode with an enforcement source): a gated route
    // with NO tenant context cannot be attributed to a tenant, so we cannot rule
    // out that it belongs to an `enforce` tenant. Fail CLOSED (D-ST-24). Every
    // authenticated request carries a tenant, so this only ever stops a request
    // whose tenant claim was lost or never set. Legacy mode (handled above, no
    // enforcement source) keeps the pre-FF-03 allow.
    return sendModuleDisabled(req, reply, moduleKey);
  }

  const configured = resolved?.configured ?? false;
  const enabledModules = resolved?.modules ?? null;

  // ── admin outage / open breaker (modules === null with configured false and
  //    no cached decision) OR configured:false (un-onboarded tenant) ──────────
  if (enabledModules === null) {
    // In off/shadow we fail OPEN exactly as before (shadow logs the would-deny).
    // In enforce we fail CLOSED: an un-onboarded tenant or an admin outage must
    // not silently grant access. The grandfather backfill (migration 0050) is
    // what makes this safe — a pre-existing tenant that reaches enforce has its
    // entitlements materialised, so `configured` is true and this branch is not
    // hit for it.
    if (mode === "enforce") {
      return resolved?.outage ? sendGuardUnavailable(req, reply) : sendModuleDisabled(req, reply, moduleKey);
    }
    if (mode === "shadow") {
      recordWouldDeny(req, routeName, resolved?.outage ? "admin_outage" : "unconfigured_tenant");
    }
    return true;
  }

  // ── normal path: decided by the allow-list ──────────────────────────────────
  if (enabledModules.has(moduleKey)) return true;

  // Module is DISABLED for this tenant and the allow-list is KNOWN (admin
  // reachable, tenant configured). This is NOT one of the ambiguous fail-open
  // signals — a configured tenant with a resolved allow-list that omits the
  // module has genuinely not licensed it. The pre-FF-03 guard already 403'd
  // this case in every mode, so off and enforce both fail closed here; only
  // shadow (an explicit soak mode) logs the would-deny and allows. This is the
  // ONE place off and enforce agree — the mode only changes the AMBIGUOUS cases
  // above (unmapped route / missing tenant / outage / configured:false).
  if (mode === "shadow") {
    recordWouldDeny(req, routeName, "module_disabled");
    return true;
  }
  return sendModuleDisabled(req, reply, moduleKey);
}

function recordWouldDeny(req: FastifyRequest, routeName: string, reason: string): void {
  shadowWouldDenyCount += 1;
  // Structured log line so the shadow soak is observable before the metric is
  // wired into /metrics. No PII — route name + reason + correlation id only.
  req.log?.warn?.(
    { event: "module_guard_would_deny", route: routeName, reason, correlationId: req.id },
    "module-guard shadow: request would be denied under enforce",
  );
}

/**
 * Fetch the tenant's effective allow-list + enforcement mode. Returns:
 *   { modules, mode, configured } on success;
 *   { modules: null, mode, configured:false } on admin outage / open breaker
 *     (modules unknown — the caller fails open in off/shadow, closed in enforce);
 *   { modules: null, mode, configured:false } for an un-onboarded tenant
 *     (configured:false) — same shape, distinguished by `configured`.
 */
async function getEnabled(tenantId: string): Promise<CacheEntry> {
  const cached = moduleCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached;

  try {
    const adminUrl = process.env.GATEWAY_ADMIN_URL ?? "http://127.0.0.1:3022";
    const useComposition = process.env.COMPOSITION_ENFORCEMENT === "on";
    const url = useComposition
      ? `${adminUrl}/v1/admin/composition/internal/${tenantId}/modules`
      : `${adminUrl}/v1/admin/tenants/${tenantId}/modules-list`;
    const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
    // Service-to-service contract: x-internal:1 + secret. The composition
    // endpoint sits behind admin's global auth hook (x-service-secret +
    // x-tenant-id); the legacy modules-list route uses x-internal-secret, and
    // (defense-in-depth, gateway-service#986 follow-up) also requires the
    // explicit x-internal:"1" flag.
    const headers: Record<string, string> = useComposition
      ? { "x-internal": "1", "x-tenant-id": tenantId, "x-service-secret": secret, "x-internal-caller": "gateway-module-guard" }
      : { "x-internal": "1", "x-internal-secret": secret, "x-internal-caller": "gateway-module-guard" };

    const body = await moduleGuardBreaker.call(async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`admin-service ${res.status}`);
      return (await res.json()) as {
        configured?: boolean;
        mode?: EnforcementMode;
        data: Array<{ name: string }>;
      };
    });

    const mode: EnforcementMode =
      body.mode === "off" || body.mode === "shadow" || body.mode === "enforce" ? body.mode : "off";
    lastKnownMode.set(tenantId, mode);

    // Composition mode: a tenant that never onboarded is `configured:false`.
    // modules stay null (unknown) so off/shadow fail open and enforce fails
    // closed; the `mode` is still cached so enforce is honoured for it.
    if (useComposition && body.configured === false) {
      const entry: CacheEntry = { modules: null, mode, configured: false, expires: Date.now() + CACHE_TTL_MS };
      moduleCache.set(tenantId, entry);
      return entry;
    }

    const modules = new Set<string>(body.data.map((m) => m.name));
    const entry: CacheEntry = { modules, mode, configured: true, expires: Date.now() + CACHE_TTL_MS };
    moduleCache.set(tenantId, entry);
    return entry;
  } catch (err) {
    // Admin outage (including CircuitBreakerOpenError): the module allow-list is
    // unknown. We do NOT cache the failure (so recovery is picked up on the next
    // request). The tenant's INTENT is sticky via lastKnownMode: if we have ever
    // seen this tenant as `enforce`, we fail CLOSED on the outage (modules:null
    // + mode:enforce ⇒ the caller 403s); otherwise we return `off` and off/shadow
    // fail open exactly as before. A tenant never seen before an outage (no
    // lastKnownMode entry) resolves to off — the acceptable availability/safety
    // trade for a genuine cold start, which the grandfather backfill + an
    // explicit mode set are expected to precede in production.
    const mode = lastKnownMode.get(tenantId) ?? "off";
    log.warn(
      { err: err instanceof Error ? err.message : String(err), breakerOpen: err instanceof CircuitBreakerOpenError, tenantId, mode },
      "module-guard: admin-service unreachable; allow-list unknown",
    );
    return { modules: null, mode, configured: false, expires: 0, outage: true };
  }
}

/**
 * Drop a tenant's cached entry. In-process only: other processes (admin-service
 * consumers, gateway-worker) reach it via POST /internal/module-cache/invalidate;
 * the 60s TTL stays the fallback bound if that best-effort call fails.
 */
export function invalidateModuleCache(tenantId: string): void {
  moduleCache.delete(tenantId);
  lastKnownMode.delete(tenantId);
}

/** Exposed for testing — access to internals */
export const _test = {
  ROUTE_TO_MODULE,
  PLATFORM_ROUTES,
  moduleCache,
  lastKnownMode,
  CACHE_TTL_MS,
  get shadowWouldDenyCount() {
    return shadowWouldDenyCount;
  },
  resetShadowCount() {
    shadowWouldDenyCount = 0;
  },
} as const;

/**
 * @civitasone/module-licence - one licence check for service-to-service HTTP calls and event consumers
 * (module-sale gap M5).
 *
 * WHY: the gateway refuses a request for a module a tenant did not buy, but services still call into, and
 * post events into, modules the tenant did not buy (e.g. payroll journals posted into finance). This package
 * is the shared check behind the gateway. It generalises smarttransfer-service/src/shared/entitlement.ts
 * (which now delegates its projection fetch here) instead of inventing a second mechanism.
 *
 * STATES, PER TENANT (the same three states as the gateway module guard, M3). The tenant's state is the
 * composition projection's `mode` (admin-service PUT /v1/admin/composition/:tenantId/enforcement-mode), so ONE
 * per-tenant switch drives the gateway and this check:
 *   off     - no behaviour change (default). Not even a log line.
 *   shadow  - ("watch-only") compute the enforce decision; if it would refuse, log + count it, then ALLOW.
 *   enforce - refuse. Fail CLOSED: unlicensed, un-onboarded (configured:false), no tenant, or the licence
 *             source unreachable all refuse (an unreachable source is reported as retryable, never as a
 *             permanent "not licensed").
 *
 * PROCESS SWITCH: nothing runs unless MODULE_LICENCE_CHECK=on in the service's environment. Unset (the
 * default) the check is a pure no-op: no fetch, no cache, no log. That is what makes this change a no-op for
 * every current tenant until it is switched on.
 *
 * TENANT SCOPING: the tenant id always comes from the server (request context / message envelope), never from
 * a payload. Cache entries, in-flight loads and the sticky last-known mode are all keyed by tenant id, and
 * every source fetch carries that tenant id as x-tenant-id.
 *
 * CATALOGUE ACCESS: the allow-list is read ONLY through a `ModuleSource` (below). Today's source is the
 * composition projection, the same endpoint the gateway guard and SmartTransfer read. When the module
 * catalogue becomes the single source of a tenant's modules, repoint `compositionProjectionSource` (or pass
 * another `ModuleSource`); no caller changes.
 */
import { CircuitBreaker } from "@civitasone/circuit-breaker";
import { incrementModuleLicenceDecision } from "@civitasone/observability";

export type LicenceMode = "off" | "shadow" | "enforce";

/** A tenant's resolved entitlements. `modules` is null only when `configured` is false. */
export interface ModuleSnapshot {
  modules: ReadonlySet<string> | null;
  configured: boolean;
  mode: LicenceMode;
}

/** Where a tenant's module list comes from. `load` THROWS when the source cannot answer (outage, breaker open). */
export interface ModuleSource {
  load(tenantId: string): Promise<ModuleSnapshot>;
}

/**
 * Gateway module keys the cross-module paths check (the keys the composition projection emits, see
 * admin-service composition/gateway-map.ts). One place to change if the catalogue renames them.
 */
export const LICENCE_MODULE = {
  finance: "finance",
  payroll: "payroll",
  /** The core HRMS surface (workforce core). */
  hrms: "workforce_core",
  procurement: "procurement",
  assets: "assets",
  stock: "stock",
  inventory: "inventory",
  contracts: "contracts",
  grants: "grants",
  billing: "billing",
  revenue: "finance",
  meeting: "meeting",
  analytics: "analytics",
  /** works-service and project-service are both served by the `projects` module. */
  works: "projects",
  project: "projects",
  legal: "legal",
  estab: "establishment",
} as const;

export const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── source: the composition projection ──────────────────────────────────────────────────────────────────────

export interface CompositionSourceOptions {
  /** Value of x-internal-caller, e.g. "payroll-service-licence". */
  caller: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function compositionProjectionSource(opts: CompositionSourceOptions): ModuleSource {
  const breaker = new CircuitBreaker({ name: `module-licence-${opts.caller}`, failureThreshold: 3, recoveryMs: 10_000 });
  return {
    async load(tenantId: string): Promise<ModuleSnapshot> {
      // Only a canonical UUID may reach the URL path (a crafted id cannot steer to another admin route).
      if (!TENANT_UUID_RE.test(tenantId)) throw new Error("invalid tenant id");
      const adminUrl = process.env.GATEWAY_ADMIN_URL ?? "http://127.0.0.1:3022";
      const url = `${adminUrl}/v1/admin/composition/internal/${encodeURIComponent(tenantId)}/modules`;
      const headers: Record<string, string> = {
        "x-internal": "1",
        "x-tenant-id": tenantId,
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-internal-caller": opts.caller,
      };
      const doFetch = opts.fetchImpl ?? fetch;
      const body = await breaker.call(async () => {
        const res = await doFetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) });
        if (!res.ok) throw new Error(`admin-service ${res.status}`);
        return (await res.json()) as { configured?: boolean; mode?: string; data?: Array<{ name: string }> };
      });
      const mode: LicenceMode = body.mode === "shadow" || body.mode === "enforce" ? body.mode : "off";
      if (body.configured === false) return { modules: null, configured: false, mode };
      return { modules: new Set((body.data ?? []).map((m) => m.name)), configured: true, mode };
    },
  };
}

// ── decision ────────────────────────────────────────────────────────────────────────────────────────────────

export type LicenceKind = "http" | "event";
export type LicenceOutcome =
  /** Proceed (licensed, mode off, or the check is switched off). */
  | "allow"
  /** shadow: it would be refused under enforce; proceed. */
  | "would_deny"
  /** enforce: not licensed. Permanent for now. */
  | "deny"
  /** enforce: the licence source could not answer. Retryable. */
  | "unavailable";

export interface LicenceDecision {
  allowed: boolean;
  outcome: LicenceOutcome;
  mode: LicenceMode;
  moduleKey: string;
  reason: string;
}

export class ModuleNotLicensedError extends Error {
  readonly code = "MODULE_NOT_LICENSED";
  constructor(readonly decision: LicenceDecision) {
    super(`Module '${decision.moduleKey}' is not licensed for this tenant (${decision.reason})`);
    this.name = "ModuleNotLicensedError";
  }
  get retryable(): boolean {
    return this.decision.outcome === "unavailable";
  }
}

export interface LicenceLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const consoleLogger: LicenceLogger = {
  warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", msg, ...obj })),
};

export interface ModuleLicenceOptions {
  /** Calling service, for logs and the metric label (e.g. "finance"). */
  service: string;
  source?: ModuleSource;
  /** Default: MODULE_LICENCE_CHECK === "on", read on every call. */
  enabled?: () => boolean;
  /** How long a tenant's snapshot is cached. Default 30 s: the staleness bound for a licence change. */
  ttlMs?: number;
  now?: () => number;
  log?: LicenceLogger;
}

export interface ConsumerSpec {
  /** Topic, for logs and metrics. */
  topic: string;
  /** Licence key of the module that OWNS this consumer (the module the event posts into). */
  module: string;
}

export interface ConsumerMessage {
  tenantId?: string | undefined;
  messageId?: string | undefined;
}

export interface ModuleLicence {
  /** Never throws. */
  check(tenantId: string | undefined, moduleKey: string, kind: LicenceKind, target: string): Promise<LicenceDecision>;
  /** For HTTP clients: resolves when the call may proceed, throws ModuleNotLicensedError when it may not. */
  assertLicensed(tenantId: string | undefined, moduleKey: string, target: string): Promise<void>;
  /**
   * Wrap an event consumer. ENFORCE + not licensed: the message is DROPPED (acked, handler not run) with a log
   * and a metric, so it does not retry and dead-letter forever. ENFORCE + source unreachable: throws a plain
   * (retryable) Error so the queue redelivers; nothing is dropped on an outage.
   */
  guardConsumer<M extends ConsumerMessage>(spec: ConsumerSpec, handler: (msg: M) => Promise<void>, onDrop?: (msg: M, decision: LicenceDecision) => void | Promise<void>): (msg: M) => Promise<void>;
  /** Test seam. */
  _reset(): void;
}

const MAX_CACHE = 5000;

export function createModuleLicence(opts: ModuleLicenceOptions): ModuleLicence {
  const source = opts.source ?? compositionProjectionSource({ caller: `${opts.service}-licence` });
  const enabled = opts.enabled ?? ((): boolean => process.env.MODULE_LICENCE_CHECK === "on");
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? ((): number => Date.now());
  const log = opts.log ?? consoleLogger;

  const cache = new Map<string, { snap: ModuleSnapshot; expires: number }>();
  const inflight = new Map<string, Promise<ModuleSnapshot>>();
  // Sticky per-tenant intent, kept past the TTL so an outage still fails CLOSED for a tenant seen as enforce.
  const lastKnownMode = new Map<string, LicenceMode>();

  function load(tenantId: string): Promise<ModuleSnapshot> {
    const existing = inflight.get(tenantId);
    if (existing) return existing;
    const p = source
      .load(tenantId)
      .then((snap) => {
        if (cache.size >= MAX_CACHE) {
          const t = now();
          for (const [k, v] of cache) if (v.expires <= t) cache.delete(k);
          if (cache.size >= MAX_CACHE) cache.clear();
        }
        cache.set(tenantId, { snap, expires: now() + ttlMs });
        lastKnownMode.set(tenantId, snap.mode);
        return snap;
      })
      .finally(() => {
        if (inflight.get(tenantId) === p) inflight.delete(tenantId);
      });
    inflight.set(tenantId, p);
    return p;
  }

  async function resolve(tenantId: string): Promise<ModuleSnapshot> {
    const hit = cache.get(tenantId);
    if (hit && hit.expires > now()) return hit.snap;
    return load(tenantId);
  }

  function record(kind: LicenceKind, d: LicenceDecision, target: string, tenantId: string | undefined): void {
    incrementModuleLicenceDecision(opts.service, d.moduleKey, kind, d.outcome);
    if (d.outcome === "allow") return;
    log.warn(
      { event: `module_licence_${d.outcome}`, service: opts.service, kind, target, module: d.moduleKey, mode: d.mode, reason: d.reason, tenantId },
      d.outcome === "would_deny"
        ? "module-licence watch-only: this would be refused under enforce"
        : "module-licence: refused",
    );
  }

  async function check(tenantId: string | undefined, moduleKey: string, kind: LicenceKind, target: string): Promise<LicenceDecision> {
    if (!enabled()) return { allowed: true, outcome: "allow", mode: "off", moduleKey, reason: "check_disabled" };

    let decision: LicenceDecision;
    if (!tenantId || !TENANT_UUID_RE.test(tenantId)) {
      // A cross-module call/event with no attributable tenant cannot be tenant-scoped; refuse (fail closed).
      decision = { allowed: false, outcome: "deny", mode: "enforce", moduleKey, reason: "no_tenant" };
      record(kind, decision, target, undefined);
      return decision;
    }
    try {
      const snap = await resolve(tenantId);
      const licensed = snap.configured && snap.modules !== null && snap.modules.has(moduleKey);
      if (licensed) decision = { allowed: true, outcome: "allow", mode: snap.mode, moduleKey, reason: "licensed" };
      else {
        const reason = snap.configured ? "module_not_licensed" : "tenant_not_configured";
        if (snap.mode === "enforce") decision = { allowed: false, outcome: "deny", mode: "enforce", moduleKey, reason };
        else if (snap.mode === "shadow") decision = { allowed: true, outcome: "would_deny", mode: "shadow", moduleKey, reason };
        else decision = { allowed: true, outcome: "allow", mode: "off", moduleKey, reason };
      }
    } catch (err) {
      const sticky = lastKnownMode.get(tenantId) ?? "off";
      const reason = `source_unavailable:${err instanceof Error ? err.message : "error"}`;
      if (sticky === "enforce") decision = { allowed: false, outcome: "unavailable", mode: "enforce", moduleKey, reason };
      else if (sticky === "shadow") decision = { allowed: true, outcome: "would_deny", mode: "shadow", moduleKey, reason };
      else decision = { allowed: true, outcome: "allow", mode: "off", moduleKey, reason };
    }
    if (decision.mode !== "off" || decision.outcome !== "allow") record(kind, decision, target, tenantId);
    return decision;
  }

  return {
    check,
    async assertLicensed(tenantId, moduleKey, target) {
      const d = await check(tenantId, moduleKey, "http", target);
      if (!d.allowed) throw new ModuleNotLicensedError(d);
    },
    guardConsumer(spec, handler, onDrop) {
      return async (msg) => {
        const d = await check(msg.tenantId, spec.module, "event", spec.topic);
        if (d.allowed) return handler(msg);
        if (d.outcome === "unavailable") {
          throw new Error(`module-licence: cannot verify '${spec.module}' for ${spec.topic}; will retry (${d.reason})`);
        }
        // Dropped on purpose: the tenant did not buy the module this consumer belongs to. Acking it (returning)
        // is what stops it retrying and dead-lettering forever.
        log.warn(
          { event: "module_licence_event_dropped", service: opts.service, topic: spec.topic, module: spec.module, messageId: msg.messageId, tenantId: msg.tenantId, reason: d.reason },
          "module-licence: event dropped (module not licensed for tenant)",
        );
        try {
          await onDrop?.(msg, d);
        } catch (err) {
          log.warn({ event: "module_licence_drop_hook_failed", topic: spec.topic, err: err instanceof Error ? err.message : String(err) }, "module-licence: onDrop hook failed");
        }
      };
    },
    _reset() {
      cache.clear();
      inflight.clear();
      lastKnownMode.clear();
    },
  };
}

// ── wiring helper ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a queue so the listed cross-module topics are licence-guarded at subscription time. `table` maps a topic to
 * the licence key of the module that OWNS the consumer (the module the event posts into). Topics not in the table
 * are subscribed untouched, so adding this to a service changes nothing until the process switch
 * (MODULE_LICENCE_CHECK=on) AND a tenant's enforcement mode are both set. Everything else on the queue is
 * forwarded as is.
 */
export function guardSubscriptions<Q extends object>(queue: Q, licence: ModuleLicence, table: Readonly<Record<string, string>>): Q {
  return new Proxy(queue, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (prop === "subscribe" && typeof value === "function") {
        return (topic: string, handler: (msg: ConsumerMessage) => Promise<void>, options?: unknown): unknown => {
          const module = Object.hasOwn(table, topic) ? table[topic] : undefined;
          const wrapped = module ? licence.guardConsumer({ topic, module }, handler) : handler;
          return (value as (...a: unknown[]) => unknown).call(target, topic, wrapped, options);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * visitor-service: config-registry audit payload builder (GAP-VISITOR-ADMIN-02).
 *
 * Every config write/deactivation emits an audit event with action
 * `config.changed` whose `oldValue` / `newValue` carry the entry's state before
 * and after (the audit-service stores these in its CERT-In old/new columns).
 * Config `value` is arbitrary JSON, so anything that looks like a credential is
 * masked before it leaves this service: by key name (secret, password, token,
 * api key, credential, private key, authorization) at any depth, or because the
 * config key itself names a secret.
 */
const SENSITIVE = /(?:secret|passw(?:or)?d|passwd|token|api[_-]?key|credential|private[_-]?key|authorization)/i;
export const REDACTED = "[REDACTED]";

export function redactConfigValue(configKey: string, value: unknown): unknown {
  if (SENSITIVE.test(configKey)) return REDACTED;
  return redactDeep(value, 0);
}

function redactDeep(v: unknown, depth: number): unknown {
  if (depth > 8) return REDACTED;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? REDACTED : redactDeep(x, depth + 1);
    }
    return out;
  }
  return v;
}

export interface ConfigSnapshot {
  configKey: string;
  value: unknown;
  label?: string | null;
  description?: string | null;
  sortOrder?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  active: boolean;
  version: number;
}

/** Redacted, JSON-object view of a config entry for oldValue/newValue. */
export function snapshot(s: ConfigSnapshot): Record<string, unknown> {
  return {
    configKey: s.configKey,
    value: redactConfigValue(s.configKey, s.value),
    label: s.label ?? null,
    description: s.description ?? null,
    sortOrder: s.sortOrder ?? 0,
    effectiveFrom: s.effectiveFrom ?? null,
    effectiveTo: s.effectiveTo ?? null,
    active: s.active,
    version: s.version,
  };
}

export function buildConfigChangedAudit(args: {
  resourceId: string;
  namespace: string;
  before: ConfigSnapshot | null;
  after: ConfigSnapshot;
  reason?: string | undefined;
}): Record<string, unknown> {
  return {
    service: "visitor-service",
    action: "config.changed",
    resourceType: "config_registry",
    resourceId: args.resourceId,
    outcome: "success",
    namespace: args.namespace,
    oldValue: args.before ? snapshot(args.before) : null,
    newValue: snapshot(args.after),
    ...(args.reason ? { reason: args.reason } : {}),
  };
}

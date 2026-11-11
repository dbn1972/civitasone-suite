/**
 * Per-tenant switch for cross-module search. DEFAULT OFF: with no configuration no producer publishes an event,
 * no consumer indexes, and the gateway answers exactly as before (knowledge + documents only).
 *
 *   GLOBAL_SEARCH_TENANTS=<tenant-uuid>,<tenant-uuid>   tenants switched on (no wildcard, by design)
 *   GLOBAL_SEARCH_DISABLED=1                            global kill switch; wins over the list
 *
 * Read on every call (a handful of string ops) so a restart-free reload of the environment is honoured. Every
 * process that produces, consumes or serves global search reads the same variables.
 */
import { UUID_RE } from "./contract.js";

export function enabledGlobalSearchTenants(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  if (/^(1|true|yes|on)$/i.test((env.GLOBAL_SEARCH_DISABLED ?? "").trim())) return new Set();
  const out = new Set<string>();
  for (const raw of (env.GLOBAL_SEARCH_TENANTS ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (UUID_RE.test(id)) out.add(id);
  }
  return out;
}

export function isGlobalSearchEnabled(tenantId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!tenantId) return false;
  return enabledGlobalSearchTenants(env).has(tenantId.trim().toLowerCase());
}

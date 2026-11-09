"use client";
import { useEffect, useState } from "react";
import type { GigwConfig, GigwConfigField } from "./departmentConfig";

/**
 * UAT b23: the footer owner (and the other GIGW identity fields) were fixed at
 * build time, so every tenant showed the same department. The tenant's own
 * values (tenant setting `gigw.identity`, set by a tenant admin) are read at
 * runtime from tenant-service. Anything the tenant has not set, and every
 * failure (signed out, offline, 4xx/5xx), falls back to the build-time config.
 *
 * Isolation: the response is per signed-in session (`private, no-store`), is
 * fetched with `cache: "no-store"` and is held only in this component's state:
 * no module-level cache, so a different tenant's session can never be served
 * the previous one's values.
 */
export const TENANT_GIGW_IDENTITY_URL = "/api/proxy/v1/tenant/gigw-identity";

const FIELDS: GigwConfigField[] = [
  "department", "wimDesignation", "wimEmail", "wimPhone", "address",
  "helpdeskEmail", "helpdeskPhone", "helpdeskHours", "pioContact", "faaContact", "reviewedAt",
];

/** Keep only the known string fields of a tenant response. */
export function sanitizeTenantGigwIdentity(raw: unknown): Partial<GigwConfig> | null {
  const identity = (raw as { identity?: unknown } | null)?.identity;
  if (!identity || typeof identity !== "object") return null;
  const out: Partial<GigwConfig> = {};
  for (const f of FIELDS) {
    const v = (identity as Record<string, unknown>)[f];
    if (typeof v === "string" && v.trim()) out[f] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Tenant values laid over the build-time config (build-time wins only where the tenant set nothing). */
export function mergeGigwConfig(buildTime: GigwConfig, tenant: Partial<GigwConfig> | null): GigwConfig {
  return tenant ? { ...buildTime, ...tenant } : buildTime;
}

export function useTenantGigwIdentity(): { identity: Partial<GigwConfig> | null; settled: boolean } {
  const [identity, setIdentity] = useState<Partial<GigwConfig> | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (typeof fetch !== "function") { setSettled(true); return; }
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch(TENANT_GIGW_IDENTITY_URL, { cache: "no-store", credentials: "same-origin", signal: ctl.signal });
        if (res.ok) setIdentity(sanitizeTenantGigwIdentity(await res.json()));
      } catch {
        if (ctl.signal.aborted) return;
        /* keep the build-time fallback */
      }
      if (!ctl.signal.aborted) setSettled(true);
    })();
    return () => ctl.abort();
  }, []);
  return { identity, settled };
}

import * as React from "react";

/**
 * Public organisation identity for the careers pages (GAP-RECRUITMENT-CAREERS-HOME-02 / PORTAL-LOGIN-02).
 *
 * Read from the tenant's own recruitment settings (GET /v1/careers/organisation, public): the name,
 * department and emblem the office configured. Nothing is invented -- a tenant that has configured
 * nothing gets a neutral header, never an invented sovereign or department claim.
 */
export type CareersOrg = {
  organisationName: string | null;
  departmentName: string | null;
  emblemUrl: string | null;
};

export const NO_ORG: CareersOrg = { organisationName: null, departmentName: null, emblemUrl: null };

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null;
}

/** https URL or an absolute path on this site; anything else (javascript:, data:, //host) is dropped. */
export function safeEmblemUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const u = v.trim();
  if (u.length === 0 || u.length > 2000) return null;
  return /^https:\/\/[^\s]+$/i.test(u) || /^\/(?!\/)[^\s]*$/.test(u) ? u : null;
}

/** Accepts the `{ data: { organisationName, ... } }` envelope; any other shape is "not configured". */
export function parseOrganisation(json: unknown): CareersOrg {
  const d = (json as { data?: unknown } | null)?.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return NO_ORG;
  const o = d as Record<string, unknown>;
  return {
    organisationName: text(o.organisationName, 200),
    departmentName: text(o.departmentName, 200),
    emblemUrl: safeEmblemUrl(o.emblemUrl),
  };
}

// React's `cache` exists in the canary React Next uses for server components, but not in the stable build
// vitest loads; fall back to the plain function there (no dedupe, same behaviour).
type CacheFn = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A) => R;
const cache: CacheFn = (React as unknown as { cache?: CacheFn }).cache ?? ((fn) => fn);

/** Never throws: an unreachable service just means the neutral header. */
export const getCareersOrg = cache(async (): Promise<CareersOrg> => {
  const base = (process.env.CIVITASONE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const tenantId = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
  try {
    const res = await fetch(`${base}/api/v1/careers/organisation`, {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return NO_ORG;
    return parseOrganisation(await res.json());
  } catch {
    return NO_ORG;
  }
});

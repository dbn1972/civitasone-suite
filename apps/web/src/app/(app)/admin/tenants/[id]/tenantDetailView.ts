import type { AdminTenantModuleUsage } from "@/app/_data/loaders";

/**
 * GAP-ADMIN-TENANTS-DETAIL-04: the sum of per-module user counts is a count of
 * module seats, not of people (one person on three modules counts three times),
 * and the backend exposes no tenant-level active-user figure. null when no
 * module reported a count, so the tile shows a dash rather than a fake 0.
 */
export function seatsInUse(modules: readonly AdminTenantModuleUsage[]): number | null {
  let total: number | null = null;
  for (const m of modules) {
    if (typeof m.users === "number") total = (total ?? 0) + m.users;
  }
  return total;
}

/** GAP-ADMIN-TENANTS-DETAIL-06: distinct tones for the Usage Level column without touching the shared StatusPill map. */
export function usagePillClass(usage: string): "good" | "warn" | "mut" | "info" {
  switch (usage.trim().toLowerCase()) {
    case "high": return "good";
    case "medium": return "warn";
    case "low": return "mut";
    default: return "info";
  }
}

export function hasNoModules(modules: readonly unknown[]): boolean {
  return modules.length === 0;
}

// GAP-ADMIN-TENANTS-DETAIL-05: tenant `settings` is an arbitrary jsonb blob, so
// any key that looks like a credential is masked at every nesting depth.
const SECRET_KEY = /secret|token|pass|pwd|credential|auth|bearer|dsn|salt|hmac|signing|private|(^|[^a-z])key([^a-z]|$)|apikey|api[-_]?key|[a-z]Key$/i;
const MASK = "••••••";

export function maskSettings(v: unknown, depth = 0): unknown {
  if (depth > 8) return MASK;
  if (Array.isArray(v)) return v.map((x) => maskSettings(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) ? MASK : maskSettings(x, depth + 1)]),
    );
  }
  return v;
}

/** Read-only key/value rows for the tenant's `settings` blob (scalars only; nested values shown as JSON). */
export function settingsRows(settings: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> {
  if (!settings || typeof settings !== "object") return [];
  return Object.entries(settings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      value: SECRET_KEY.test(key) ? MASK : v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(maskSettings(v)) : String(v),
    }));
}

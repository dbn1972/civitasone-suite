// NOTE: no `import "server-only"` here — that package is not a dependency of this
// app and fails to resolve under vitest (breaking the render-smoke contract). The
// server-only guarantee comes from fetchJson, which pulls in next/headers.
import { fetchJson } from "@/app/_data/apiClient";
import { SETUP_SKIPPED_STEPS_KEY } from "@/lib/setupSteps";

/**
 * GAP-SETUP-HOME-02 — read the per-tenant list of skipped (deferred) setup
 * steps from the tenant-service settings store (key `setup.skipped_steps`).
 *
 * The persistence is the generic tenant-settings key/value store
 * (tenant-service `/v1/settings`, proxied as `/api/v1/tenant/settings/:key`),
 * which already does CQRS + audit + tenant scoping + admin role gating. The
 * value is an array of WizardStep keys. On any failure (403 for a non-admin
 * viewer, offline, or a never-set key → 404) we return an empty list so the
 * wizard shows every step as still to-do rather than inventing a deferral.
 */
export async function getSkippedSteps(): Promise<string[]> {
  const result = await fetchJson<unknown, string[]>(
    `/api/v1/tenant/settings/${encodeURIComponent(SETUP_SKIPPED_STEPS_KEY)}`,
    [],
    {
      // Short cache: a freshly-persisted skip should show on the next visit.
      revalidateSeconds: 5,
      telemetryKey: "setup.skipped-steps",
      mapResponse: (payload) => {
        // SettingView = { key, value, ... }; value is the stored JSON array.
        const value =
          payload && typeof payload === "object" && "value" in (payload as object)
            ? (payload as { value: unknown }).value
            : payload;
        if (!Array.isArray(value)) return [];
        return value.filter((v): v is string => typeof v === "string");
      },
    },
  );
  return result.source === "api" ? result.data : [];
}

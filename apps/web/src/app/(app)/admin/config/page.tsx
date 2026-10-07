import { PageHeader, LoadErrorState } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";
import { ConfigForm } from "./ConfigForm";
import type { PlatformControllable } from "./configDiff";

// GAP-ADMIN-CONFIG-01/02: this page used to seed its form with literals
// (platformName "CivitasOne", 5 login attempts, 30 min ...) and PATCH them over
// whatever was configured. admin-service's PATCH /v1/admin/platform-config only
// accepts { cacheTtl, rateLimits, logLevel, debugModeUntil, notifications }
// (.strict()), so every one of those fields was rejected -- the screen could
// never have saved anything. It now loads the real GET response, is gated to
// platform_admin/super_admin (the same gate admin-service enforces), and edits
// only the parameters that actually exist.
export default async function AdminConfigPage() {
  requireAnyRole(ADMIN_PLATFORM_ROLES);
  const res = await fetchJson<unknown, { controllable: PlatformControllable } | null>("/api/v1/admin/platform-config", null, {
    telemetryKey: "admin.platform_config",
    mapResponse: (p) => {
      const c = (p as { controllable?: PlatformControllable } | null)?.controllable;
      return c && typeof c === "object" ? { controllable: c } : null;
    },
  });

  if (res.source === "error" || !res.data) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Platform Configuration" subtitle="Tunable platform parameters." back="/admin" />
        <LoadErrorState result={res} area="platform configuration" backHref="/admin" requiredRoles={ADMIN_PLATFORM_ROLES} />
      </div>
    );
  }
  return <ConfigForm initial={res.data.controllable} />;
}

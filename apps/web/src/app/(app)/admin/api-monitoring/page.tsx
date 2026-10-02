import { PageHeader } from "@/app/_components/ds";
import { getSAApiMonitoring } from "@/app/_data/loaders";
import { ApiMonitoringTable } from "./ApiMonitoringTable";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";

export default async function ApiMonitoringPage() {
  // GAP-ADMIN-API-MONITORING-01: platform-operator console.
  requireAnyRole(ADMIN_PLATFORM_ROLES);
  const res = await getSAApiMonitoring();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ADMIN-API-MONITORING-02: the summary cards, the data-source badge and
          the failure state all live in ApiMonitoringTable, driven by the same
          useSeededResource call that produces its rows, so they cannot disagree. */}
      <PageHeader title="API Monitoring" subtitle="Service endpoint health, latency and error rates." back="/admin" />
      <ApiMonitoringTable
        endpoints={res.data}
        source={res.source === "error" ? "error" : "api"}
        status={res.status}
        errorMessage={res.errorMessage}
      />
    </div>
  );
}

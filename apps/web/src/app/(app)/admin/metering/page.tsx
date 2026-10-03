import { PageHeader } from "@/app/_components/ds";
import { getSAMetering, getUsageQuotas } from "@/app/_data/loaders";
import { UsageLimitsPanel } from "./UsageLimitsPanel";
import { MeteringTable } from "./MeteringTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function MeteringPage() {
  // GAP-ADMIN-METERING-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Usage Metering" area="usage metering" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const [{ data: meters, source, status, errorMessage }, quotas] = await Promise.all([getSAMetering(), getUsageQuotas()]);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ADMIN-METERING-03/-04: stat cards, badge and failure state live inside
          MeteringTable, driven by the same useSeededResource call as its rows. */}
      <PageHeader title="Usage Metering" subtitle="Resource consumption and billing by period for your signed-in organisation (billing data is tenant-scoped; it does not list other tenants)." back="/admin" />
      <UsageLimitsPanel resources={quotas.data} source={quotas.source === "error" ? "error" : "api"} errorStatus={quotas.status} />
      <MeteringTable meters={meters} source={source === "error" ? "error" : "api"} errorStatus={status} errorMessage={errorMessage} />
    </div>
  );
}

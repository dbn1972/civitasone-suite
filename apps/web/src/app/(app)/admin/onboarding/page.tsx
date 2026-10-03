import { PageHeader } from "@/app/_components/ds";
import { getSAOnboarding } from "@/app/_data/loaders";
import { OnboardingTable } from "./OnboardingTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function OnboardingPage() {
  // GAP-ADMIN-ONBOARDING-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tenant Onboarding Queue" area="the tenant onboarding queue" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: queue, source, status, errorMessage } = await getSAOnboarding();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ADMIN-ONBOARDING-02/-03: stat cards, badge and failure state live inside
          OnboardingTable, driven by the same useSeededResource call as its rows. */}
      <PageHeader title="Tenant Onboarding Queue" subtitle="New tenant requests and onboarding pipeline status." back="/admin" />
      {/* GAP-ADMIN-ONBOARDING-05: export and reveal are platform-operator actions, and both are audited server-side. */}
      <OnboardingTable queue={queue} source={source === "error" ? "error" : "api"} errorStatus={status} errorMessage={errorMessage} canExport canReveal canManage />
    </div>
  );
}

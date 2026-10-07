import { PageHeader } from "@/app/_components/ds";
import { getSAEntitlements } from "@/app/_data/loaders";
import { EntitlementsTable } from "./EntitlementsTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function EntitlementsPage() {
  // GAP-ADMIN-ENTITLEMENTS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Entitlements" area="platform entitlements" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: entitlements, source, status } = await getSAEntitlements();

  return (
    <div className="page-main wrap">
      {/* GAP-ADMIN-ENTITLEMENTS-02/03: stats, provenance badge, error state and table
          all live in EntitlementsTable, fed by ONE useSeededResource call. */}
      <PageHeader title="Entitlements" subtitle="Module and feature entitlements per edition and tenant override." back="/admin" />
      <EntitlementsTable entitlements={entitlements} source={source === "error" ? "error" : "api"} unavailable={status === 404 || status === 501} />
    </div>
  );
}

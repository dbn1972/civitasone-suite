import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { getSATenants } from "@/app/_data/loaders";
import { TenantsTable } from "./TenantsTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function TenantsPage() {
  // GAP-ADMIN-TENANTS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tenants" area="the tenant directory" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: tenants, source } = await getSATenants();

  return (
    <div className="page-main wrap">
      {/* UX-012 / GAP-ADMIN-TENANTS-03: the data-source badge AND the summary tiles live inside
          TenantsTable, driven by the same useSeededResource call that produces its rows -- not a
          second, independent read of the server data here that could disagree with the table's
          own cache state (UX-002's pattern). */}
      {/* GAP-ADMIN-TENANTS-04: no tenant-create flow exists yet, so only the onboarding queue is linked. */}
      <PageHeader
        title="Tenants"
        subtitle="All registered tenants with edition, status and usage details."
        back="/admin"
        actions={<Link className="btn ghost" href="/admin/onboarding">Onboarding queue</Link>}
      />
      <TenantsTable tenants={tenants} source={source === "error" ? "error" : "api"} />
    </div>
  );
}

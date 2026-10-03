import { PageHeader } from "@/app/_components/ds";
import { getSATechAdmin } from "@/app/_data/loaders";
import { TechAdminTable } from "./TechAdminTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function TechAdminPage() {
  // GAP-ADMIN-TECH-ADMIN-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tech Admin" area="platform service health" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: services, source } = await getSATechAdmin();
  // GAP-ADMIN-TECH-ADMIN-05: stamped per server render; also the remount key so Refresh shows fresh rows.
  const fetchedAt = new Date().toISOString();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tech Admin" subtitle="Service health, database connections, and infrastructure status." back="/admin" />
      <TechAdminTable key={fetchedAt} services={services} source={source === "error" ? "error" : "api"} fetchedAt={fetchedAt} />
    </div>
  );
}

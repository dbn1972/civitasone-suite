import { PageHeader, EmptyState } from "@/app/_components/ds";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

// COMP-004: this page used to render 6 hardcoded MOCK_SERVICES and silently fell
// back to that fake list whenever its (also fake) GET /v1/admin/discovery/services
// request failed. No service registry or health scanner exists, so the screen is an
// explicit placeholder rather than a wired page: no fabricated services, and no
// scan button that could only ever fail (GAP-ADMIN-DISCOVERY-03/-04 removed the
// disabled button, the developer-facing "no backend" wording and the inline hex
// colours). Do not add a working control until a real endpoint exists.
// Deliberately not linked from the /admin hub for the same reason.
export default function AdminDiscoveryPage() {
  // GAP-ADMIN-DISCOVERY-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Service Discovery" area="service discovery" roles={PLATFORM_ADMIN_ROLES} />;
  }
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Service Discovery" subtitle="Service discovery is coming soon." back="/admin" />
      <div className="card">
        <EmptyState
          icon="🛠️"
          title="Not available yet"
          message="Discovering and monitoring connected services is planned for a future release. Nothing needs to be done here for now."
        />
      </div>
    </div>
  );
}

import { PageHeader, EmptyState } from "@/app/_components/ds";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

// COMP-004: this page used to render 3 hardcoded MOCK_JOBS as "Recent Jobs" and a
// "New Scan Job" form that posted to a plausible-looking POST /v1/admin/bulk-scan.
// No service registers a bulk-scan job queue, so the screen is an explicit
// placeholder rather than a wired page: no fabricated jobs, and no Queue button
// that could only ever fail (GAP-ADMIN-BULK-SCAN-03/-04 removed the disabled
// button, the developer-facing "no backend" wording and the inline hex colours).
// Do not add a working control until a real endpoint exists. Deliberately not
// linked from the /admin hub for the same reason.
export default function AdminBulkScanPage() {
  // GAP-ADMIN-BULK-SCAN-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Bulk Scan" area="bulk scan" roles={PLATFORM_ADMIN_ROLES} />;
  }
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Bulk Scan" subtitle="Bulk accessibility scans are coming soon." back="/admin" />
      <div className="card">
        <EmptyState
          icon="🛠️"
          title="Not available yet"
          message="Bulk scanning is planned for a future release. Nothing needs to be done here for now."
        />
      </div>
    </div>
  );
}

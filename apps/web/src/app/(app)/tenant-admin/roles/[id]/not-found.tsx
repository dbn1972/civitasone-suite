import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-TENANT-ADMIN-ROLES-DETAIL-03: shown only for a genuine 404 (unknown role
// id) via notFound(); a fetch failure renders the retryable error card in
// page.tsx instead, so an outage never masquerades as a deleted role.
export default function RoleNotFound() {
  return (
    <div className="page-main wrap">
      <EmptyState
        icon="🔑"
        title="Role not found"
        message="This role does not exist or has been deleted."
      />
      <p style={{ marginTop: 12 }}>
        <Link href="/tenant-admin/roles" className="lnk">← Back to Manage Roles</Link>
      </p>
    </div>
  );
}

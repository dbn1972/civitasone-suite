import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-TENANT-HOME-03: the not-found state had no way back. Give it a visible
// link to the office home and to the dashboard, in plain language (no "tenant").
export default function TenantNotFound() {
  return (
    <div className="page-main">
      <EmptyState
        title="Page not found"
        message="The page you are looking for does not exist or has been moved."
        action={
          <div className="empty-state__actions" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
            <Link href="/tenant" className="btn btn-primary">Back to Office home</Link>
            <Link href="/dashboard" className="btn btn-secondary">Go to dashboard</Link>
          </div>
        }
      />
    </div>
  );
}

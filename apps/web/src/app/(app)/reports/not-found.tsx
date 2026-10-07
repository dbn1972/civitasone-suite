import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-REPORTS-HOME-02: the not-found state offered no way back — a user who
// landed on an unmatched nested path (e.g. /reports/a/b) was stranded. Add a
// "Back to Reports" action so there is always a route out, matching the
// pattern used elsewhere (EmptyState `action` prop).
export default function ReportsNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={
        <Link href="/reports" className="btn primary">
          Back to Reports
        </Link>
      }
    />
  );
}

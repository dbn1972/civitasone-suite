import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

/** Skeleton for AttendancePage (server component). Shown by Next.js Suspense while
 *  the page awaits getAttendanceList(). Prevents the empty-state flash (W5). */
export default function AttendanceLoading() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Attendance"
        subtitle="Daily presence and punctuality records."
      />
      <SkeletonTable rows={8} />
    </main>
  );
}

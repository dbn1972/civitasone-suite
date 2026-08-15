import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

/** Skeleton for EmployeeDirectoryPage (server component). Shown by Next.js Suspense while
 *  the page awaits getEmployees() / getHRDashboard(). Prevents the empty-state flash (W5). */
export default function EmployeesLoading() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Employee Directory"
        subtitle="All staff, grades and posting locations."
        actions={
          /* mirror the Add Employee button so header height is stable */
          <div
            aria-hidden="true"
            style={{
              width: 130,
              height: 36,
              borderRadius: 8,
              background: "var(--line2)",
              backgroundImage:
                "linear-gradient(90deg, var(--line2) 0%, var(--line) 35%, var(--line2) 70%)",
              backgroundSize: "200% 100%",
              animation: "sk-shimmer 1.5s ease-in-out infinite",
            }}
          />
        }
      />
      <SkeletonTable rows={10} />
    </main>
  );
}

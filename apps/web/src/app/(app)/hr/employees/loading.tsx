import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/** Skeleton for EmployeeDirectoryPage (server component). Shown by Next.js Suspense while
 *  the page awaits getEmployees() / getHRDashboard(). Prevents the empty-state flash (W5). */
export default async function EmployeesLoading() {
  const t = await getTranslations("employees");
  return (
    <div className="page-main wrap">
      {/* GAP-HR-EMPLOYEES-07: loadingTitle/loadingSubtitle used to say
          "Employee Directory" / "All staff, grades and posting locations"
          -- a different heading (and a promise this page doesn't keep)
          from the loaded page's own "Employees" title, so the heading
          visibly flashed/changed the moment data arrived. */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
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
    </div>
  );
}

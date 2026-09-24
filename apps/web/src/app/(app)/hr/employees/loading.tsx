import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/** Skeleton for EmployeeDirectoryPage (server component). Shown by Next.js Suspense while
 *  the page awaits getEmployees() / getHRDashboard(). Prevents the empty-state flash (W5). */
export default async function EmployeesLoading() {
  const t = await getTranslations("employees");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("loadingTitle")}
        subtitle={t("loadingSubtitle")}
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

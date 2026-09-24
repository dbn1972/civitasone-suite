import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

const shimmer = {
  background: "var(--line2)",
  backgroundImage:
    "linear-gradient(90deg, var(--line2) 0%, var(--line) 35%, var(--line2) 70%)",
  backgroundSize: "200% 100%",
  animation: "sk-shimmer 1.5s ease-in-out infinite",
  borderRadius: 8,
  height: 36,
} as const;

/** Skeleton for LeaveManagementPage (server component). Shown by Next.js Suspense while
 *  the page awaits getLeaveRequestDetails(). Prevents the empty-state flash (W5). */
export default async function LeaveLoading() {
  const t = await getTranslations("leave");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
        actions={
          /* mirror the 6 action buttons (Balance, History, Allocate, Policies, Approvals, Apply) */
          <div aria-hidden="true" style={{ display: "flex", gap: 8 }}>
            {[80, 80, 80, 82, 96, 102].map((w, i) => (
              <div key={i} style={{ ...shimmer, width: w }} />
            ))}
          </div>
        }
      />
      <SkeletonTable rows={8} />
    </div>
  );
}

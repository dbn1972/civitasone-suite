import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/** Skeleton for AttendancePage (server component). Shown by Next.js Suspense while
 *  the page awaits getAttendanceList(). Prevents the empty-state flash (W5). */
export default async function AttendanceLoading() {
  const t = await getTranslations("attendance");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <SkeletonTable rows={8} />
    </div>
  );
}

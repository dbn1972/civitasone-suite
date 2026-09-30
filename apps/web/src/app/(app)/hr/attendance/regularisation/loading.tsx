import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-ATTENDANCE-REGULARISATION-05 (loading half): PageHeader used to sit
 * as a sibling BEFORE `.page-main.wrap`, while the real page.tsx wraps its
 * own PageHeader INSIDE `.page-main.wrap` -- so header alignment/padding
 * jumped the moment real content replaced this skeleton. Now matches the
 * real page's structure exactly.
 */
export default async function RegularisationLoading() {
  const t = await getTranslations("attendanceRegularisation");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitleLoading")}
        back="/hr/attendance" backLabel="Back to Attendance"
      />
      <SkeletonTable rows={5} />
    </div>
  );
}

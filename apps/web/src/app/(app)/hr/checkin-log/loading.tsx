import { SkeletonTable, SkeletonCard, PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-CHECKIN-LOG-05: this used to be a single unlabeled `<div
 * className="skeleton">` — `.skeleton` has no CSS rule anywhere in the repo
 * (grepped), so it rendered nothing visible at all, with no page header or
 * stat placeholders either. Mirrors the sibling hr/attendance/loading.tsx
 * fix (GAP-HR-ATTENDANCE-07): a real PageHeader, a 4-card stat grid
 * placeholder, and the shared SkeletonTable — all built from ds/Skeleton,
 * which is CSS-variable/inline-style driven and does not depend on the
 * missing `.skeleton` class.
 */
export default async function CheckinLogLoading() {
  const t = await getTranslations("checkinLog");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}

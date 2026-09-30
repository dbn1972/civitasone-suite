import { PageHeader, SkeletonTable } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-LEAVE-ALLOCATE-06: was a client-agnostic `<div aria-label="Loading…">`
 * with no i18n at all. Rebuilt as an async server component (same shell as
 * hr/leave/loading.tsx) so the aria-label is translated like every other
 * loading treatment in this app.
 */
export default async function Loading() {
  const t = await getTranslations("leaveAllocate");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/leave" backLabel={t("backLabel")} />
      <div aria-label={t("loadingOption")}>
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}

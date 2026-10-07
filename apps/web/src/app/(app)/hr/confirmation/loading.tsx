import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonCard } from "../../../_components/ds";

// GAP-HR-CONFIRMATION-08: was a bare `<div class=skeleton>` with a
// hard-coded English aria-label and no header/stat-card shape at all --
// replaced with the same PageHeader + stat-card + card-grid skeleton shape
// hr/dashboard/loading.tsx already establishes, using this page's own real
// title/subtitle/labels so there's no layout jump when the real content
// swaps in.
export default async function ConfirmationLoading() {
  const t = await getTranslations("confirmation");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

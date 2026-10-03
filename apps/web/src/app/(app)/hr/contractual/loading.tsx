import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonCard, SkeletonTable } from "../../../_components/ds";

/**
 * GAP-HR-DEPARTMENTS-NEW-05 (sibling treatment): was a bare `.skeleton` div with
 * no header or shape. Now the real title/subtitle plus the stat-card row and a
 * table skeleton this page renders, so nothing jumps when content swaps in; the
 * region carries the localized "Loading" label for screen readers.
 */
export default async function Loading() {
  const t = await getTranslations("contractual");
  const tm = await getTranslations("msg");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true" aria-label={tm("loading")}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}

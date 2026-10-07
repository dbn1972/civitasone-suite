import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonCard } from "../../../_components/ds";

/**
 * GAP-HR-CERTIFICATIONS-04: was a bare `<div className="skeleton"
 * aria-label="Loading…">` -- `.skeleton` has no CSS rule anywhere in
 * apps/web/src (only ds/Skeleton's shimmer components and the sk-shimmer
 * keyframes exist), so it rendered empty/invisible, and a plain `div` with
 * `aria-label` but no `role` isn't announced to screen readers either.
 * Replaced with the same PageHeader + stat-card + card-grid skeleton shape
 * hr/confirmation/loading.tsx and hr/dashboard/loading.tsx already
 * establish, using this page's own real, translated title/subtitle so
 * there is no layout jump when the real content swaps in, plus an explicit
 * role="status" region so "Loading…" is actually announced, in the current
 * locale.
 */
export default async function Loading() {
  const t = await getTranslations("certifications");
  const tMsg = await getTranslations("msg");
  return (
    <div className="page-main wrap">
      <span role="status" aria-busy="true" className="sr-only">{tMsg("loading")}</span>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backToHr")} actions={<span />} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

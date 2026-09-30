/**
 * GAP-HR-APAR-07: the old skeleton was a single unlabeled-in-shape
 * `<div className="skeleton" aria-label="Loading…">` block with no visual
 * relation to the real page (a StatGrid of 5 cards, then a flow-card
 * grid). Composed here from the shared shimmer primitives
 * (ds/Skeleton.tsx, already built for SF-11) instead of inventing a new
 * generic PageSkeleton abstraction — this page's shape (title + 5 stat
 * cards + N flow cards) doesn't repeat anywhere else in /hr yet, so a
 * bespoke composition is the smaller, safer change than adding a new
 * shared component this file would be the only consumer of.
 */
import { getTranslations } from "next-intl/server";
import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

export default async function Loading() {
  const t = await getTranslations("apar");
  return (
    <div className="page-main wrap" aria-busy="true" aria-label={t("loadingAriaLabel")}>
      <SkeletonBar w="220px" h={24} style={{ marginBottom: 20 }} />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", marginBottom: 20 }}>
        {Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

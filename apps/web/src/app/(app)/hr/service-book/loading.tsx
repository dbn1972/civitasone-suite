/**
 * GAP-HR-SERVICE-BOOK-07: the old skeleton was a single unlabeled-in-shape
 * `<div className="skeleton">` block with no visual relation to the real
 * page (PageHeader + a 4-card StatGrid + a 7-column table). Composed here
 * from the shared shimmer primitives (ds/Skeleton.tsx), matching the same
 * pattern hr/apar/loading.tsx and hr/payroll/structures/loading.tsx already
 * use, instead of the previous bare div.
 */
import { getTranslations } from "next-intl/server";
import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/app/_components/ds";

export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" aria-busy="true" aria-label={t("loading")}>
      <SkeletonBar w="220px" h={24} style={{ marginBottom: 20 }} />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", marginBottom: 20 }}>
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}

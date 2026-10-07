import { SkeletonTable } from "@/app/_components/ds";

// GAP-ANALYTICS-AI-INSIGHTS-05: the single blank .skeleton block caused a
// layout shift when the real 4-stat + table page arrived. Mirror that shape.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading AI insights">
      <SkeletonTable rows={6} />
    </div>
  );
}

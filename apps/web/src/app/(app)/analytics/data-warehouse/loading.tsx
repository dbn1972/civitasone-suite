import { SkeletonTable } from "@/app/_components/ds";

// GAP-ANALYTICS-AI-INSIGHTS-05 / DATA-WAREHOUSE-04: mirror the 4-stat + table
// page shape instead of a single blank block, to avoid a load-time shift.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading data warehouse">
      <SkeletonTable rows={6} />
    </div>
  );
}

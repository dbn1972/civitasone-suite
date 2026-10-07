import { SkeletonTable } from "../../../_components/ds/Skeleton";

/**
 * GAP-CATALOGUE-HOME-03: table-shaped loading skeleton for the rates list
 * route, using design-system CSS variables (no white flash in dark mode).
 */
export default function Loading() {
  return (
    <div className="page-main">
      <SkeletonTable rows={8} />
    </div>
  );
}

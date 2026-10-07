import { SkeletonTable } from "../../../_components/ds/Skeleton";

/**
 * GAP-CATALOGUE-HOME-03: the four child list routes used to inherit the hub's
 * loading.tsx (a tile-shaped placeholder). A table page needs a table-shaped
 * skeleton; SkeletonTable uses design-system CSS variables so dark mode shows
 * no white flash.
 */
export default function Loading() {
  return (
    <div className="page-main">
      <SkeletonTable rows={8} />
    </div>
  );
}

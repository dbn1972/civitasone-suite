import { SkeletonBar, SkeletonTable } from "../../../_components/ds/Skeleton";

/**
 * GAP-CRM-GRIEVANCES-07: the loaded page leads with a StatGrid of stat tiles
 * above the register table, but the old skeleton rendered only a breadcrumb,
 * a title bar and a single h-80 block — so the tile row and table shifted
 * down on load. This skeleton now mirrors the real layout (breadcrumb +
 * title + the four-tile row + filter bar + table rows) using the ds Skeleton
 * primitives, which are built on theme tokens (--line2/--line/--panel) so the
 * dark-mode skeleton is not a light-grey block.
 */
export default function GrievancesLoading() {
  return (
    <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* breadcrumb + title */}
      <SkeletonBar w={160} h={13} />
      <SkeletonBar w={220} h={28} />
      {/* four stat tiles + filter bar + table rows (mirrors the loaded page) */}
      <SkeletonTable rows={8} />
    </div>
  );
}

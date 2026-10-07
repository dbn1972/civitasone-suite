import { TileHubSkeleton } from "../../_components/ds/Skeleton";

/**
 * GAP-BILLING-HOME-04: the old skeleton drew four stat-card blocks and a 288px
 * table block inside a `min-h-screen bg-slate-50` wrapper, none of which the
 * loaded hub has — the hub is a ModuleHub (PageHeader + a single LinkTiles
 * tile grid). That mismatch caused a layout shift on load. This mirrors the
 * real shape: the `page-main` wrapper ModuleHub uses, a header, and one
 * section of tile placeholders (the hub has five tiles).
 */
export default function BillingLoading() {
  return (
    <div className="page-main">
      <TileHubSkeleton sections={1} tilesPerSection={5} />
    </div>
  );
}

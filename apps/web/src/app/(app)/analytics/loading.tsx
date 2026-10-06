import { TileHubSkeleton } from "@/app/_components/ds";

// GAP-ANALYTICS-HOME-02: /analytics is a ModuleHub of static links that
// fetches nothing, so the previous stat-card + 6-row-table skeleton flashed a
// data layout this screen never renders (the segment layout only awaits
// ModuleGate). Match the real page: a header + a single grid of tile
// placeholders, no stat row and no table. Sub-routes keep their own
// loading.tsx, so this only affects the hub itself.
export default function AnalyticsLoading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading analytics">
      <TileHubSkeleton sections={1} tilesPerSection={6} />
    </div>
  );
}

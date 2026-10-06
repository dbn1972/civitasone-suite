import { TileHubSkeleton } from "../../_components/ds/Skeleton";

/**
 * GAP-CATALOGUE-HOME-03: the hub page renders only LinkTiles, so its loading
 * state must be tile skeletons — not four stat cards and a 384px table block,
 * which caused a layout jump on load. TileHubSkeleton uses the design-system
 * CSS variables (--line2/--line/--panel) so dark mode shows no white flash,
 * replacing the previous hard-coded bg-slate-50 / bg-gray-200 / bg-white.
 */
export default function CatalogueLoading() {
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <TileHubSkeleton sections={1} tilesPerSection={4} />
    </div>
  );
}

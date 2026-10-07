import { TileHubSkeleton } from "../../_components/ds/Skeleton";

/**
 * GAP-RECOMMENDATIONS-HOME-03: the loaded hub is a header plus four LinkTiles,
 * not four stat cards and a 24rem block. This skeleton mirrors that exact
 * shape (one section, four tile-shaped blocks) using the shared shimmer
 * component, so there is no layout shift between skeleton and loaded hub.
 */
export default function RecommendationsLoading() {
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <TileHubSkeleton sections={1} tilesPerSection={4} />
    </div>
  );
}

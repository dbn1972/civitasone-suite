import { TileHubSkeleton } from "../../_components/ds";

// GAP-JOURNEYS-HOME-04: the hub skeleton now mirrors the loaded hub (header +
// a four-tile grid) instead of four KPI cards and a full-height table that
// matched none of the journeys routes. Table-shaped sub-pages carry their own
// loading.tsx (active/analytics/builder/templates) with a table skeleton.
export default function JourneysLoading() {
  return (
    <div className="page-main">
      <TileHubSkeleton sections={1} tilesPerSection={4} />
    </div>
  );
}

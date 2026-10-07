import { TileHubSkeleton } from "../../_components/ds/Skeleton";

// GAP-CDP-HOME-02: the CDP hub renders a PageHeader + LinkTiles (five tiles),
// not stats or a table. The old skeleton showed four stat cards and a 96-unit
// block with hard-coded slate/gray hexes (a white flash in dark mode). Mirror
// the real layout with the shared, theme-tokenised TileHubSkeleton instead.
export default function CdpLoading() {
  return (
    <div className="page-main">
      <TileHubSkeleton sections={1} tilesPerSection={5} />
    </div>
  );
}

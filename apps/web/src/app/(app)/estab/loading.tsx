import { TileHubSkeleton } from "@/app/_components/ds/Skeleton";

/**
 * GAP-ESTAB-HOME-03: the Establishment hub is a grid of nav tiles, not a
 * stats + table page. Paint a tile-hub skeleton that mirrors the loaded
 * layout and inherits the app-shell padding (no min-h-screen / bg-slate-50),
 * matching the DS instead of raw tailwind slate blocks. This loader is also
 * inherited by estab children that lack their own loading.tsx, so a generic
 * header + tile grid is a safer default than a stats/table flash.
 */
export default function EstabLoading() {
  return (
    <div className="page-main">
      <TileHubSkeleton sections={1} tilesPerSection={12} />
    </div>
  );
}

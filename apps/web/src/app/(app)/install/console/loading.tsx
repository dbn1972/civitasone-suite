import { TileHubSkeleton } from "@/app/_components/ds";

/**
 * GAP-INSTALL-CONSOLE-04: the segment-wide install/loading.tsx draws a
 * stat-table skeleton, which does not match this tile-grid hub and caused a
 * layout jump on load. A dedicated hub skeleton (header + one tile grid)
 * matches the console's actual shape and uses DS tokens (dark-mode safe).
 */
export default function InstallConsoleLoading() {
  return (
    <div className="page-main">
      <TileHubSkeleton sections={1} tilesPerSection={6} />
    </div>
  );
}

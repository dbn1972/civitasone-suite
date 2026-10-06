import { SkeletonTable, TileHubSkeleton } from "./ds/Skeleton";

/**
 * RouteSkeleton — a shared route-level loading placeholder (GAP-NOTIFICATIONS-HOME-02).
 *
 * Replaces the hand-rolled `min-h-screen bg-slate-50 … bg-slate-200` blocks that
 * several route `loading.tsx` files copied: those hard-code a light background
 * that fights the app-shell background and ignores dark mode (dark mode is a
 * `.dark` class, so a fixed slate-50/200 stays light), and `min-h-screen`
 * double-counts the shell's own min-height.
 *
 * It composes the existing DS skeleton primitives (SkeletonTable / TileHubSkeleton),
 * which already use the theme tokens (--line/--line2/--panel) and so follow dark
 * mode automatically, and adds no page-level background or min-height wrapper —
 * it inherits the app-shell padding exactly like the loaded page does.
 *
 *  - variant="tiles" (hub): a header + a 3×N tile grid, matching a ModuleHub.
 *  - variant="list" (default): a stat row + filter bar + table rows.
 */
export function RouteSkeleton({
  variant = "list",
  rows = 8,
  tileRows = 2,
}: {
  variant?: "tiles" | "list";
  rows?: number;
  tileRows?: number;
}) {
  if (variant === "tiles") {
    // A single section of a 3-wide grid; `tileRows` rows of tiles (3×2 = 6 by default).
    return <TileHubSkeleton sections={1} tilesPerSection={tileRows * 3} />;
  }
  return <SkeletonTable rows={rows} />;
}

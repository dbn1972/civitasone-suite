import { TileHubSkeleton } from "@/app/_components/ds";

// GAP-REPORTS-HOME-04: the previous skeleton drew a breadcrumb, 4 stat blocks
// and two tall table blocks that the static ModuleHub hub never renders (it has
// no data fetch), and used hard-coded `bg-slate-50`/`min-h-screen` that stay
// light in dark mode. Replace with the shared TileHubSkeleton (token-based,
// no page background wrapper, matches the hub's grouped tile grid — now two
// groups of 3 and 2 tiles), the same fix applied to the CRM hub.
export default function ReportsLoading() {
  return <TileHubSkeleton sections={2} tilesPerSection={3} />;
}

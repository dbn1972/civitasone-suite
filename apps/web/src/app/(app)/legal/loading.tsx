import { TileHubSkeleton } from "../../_components/ds/Skeleton";

export default function LegalLoading() {
  // Mirror the loaded Legal hub (six tiles, no stat row) and inherit the
  // app-shell padding and theme tokens instead of a min-h-screen/bg-slate-50
  // wrapper, so the skeleton is correct in dark mode (GAP-LEGAL-HOME-03).
  return <TileHubSkeleton sections={6} />;
}

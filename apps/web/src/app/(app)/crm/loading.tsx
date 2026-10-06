import { TileHubSkeleton } from "../../_components/ds/Skeleton";

export default function CRMLoading() {
  // Mirror the loaded hub (five tile sections, no stat row) and inherit the
  // app-shell padding instead of a min-h-screen/bg-slate-50 wrapper
  // (GAP-CRM-HOME-04).
  return <TileHubSkeleton sections={5} />;
}

import { RouteSkeleton } from "../../_components/RouteSkeleton";

// GAP-NOTIFICATIONS-HOME-02: the hub is a tile grid, so its loading state is a
// 3×2 tile skeleton that follows dark mode (DS tokens) and does not force a
// light min-h-screen background that fights the app shell.
export default function NotificationsLoading() {
  return <RouteSkeleton variant="tiles" />;
}

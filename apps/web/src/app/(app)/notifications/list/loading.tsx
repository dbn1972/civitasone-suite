import { RouteSkeleton } from "../../../_components/RouteSkeleton";

// GAP-NOTIFICATIONS-HOME-02: shared skeleton (DS tokens, dark-mode safe) in
// place of the min-h-screen/bg-slate-50 block that ignored dark mode.
export default function NotificationsListLoading() {
  return <RouteSkeleton variant="list" />;
}

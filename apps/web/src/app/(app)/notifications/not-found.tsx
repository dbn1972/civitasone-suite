import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-NOTIFICATIONS-HOME-03: the module not-found page previously rendered an
// EmptyState with title + message only, leaving the user on a dead end inside
// the module. EmptyState accepts an `action` slot (see ds/EmptyState.tsx) and
// other pages pass one (templates/[id]/page.tsx); give the user a way back to
// the module hub.
export default function NotificationsNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={
        <Link className="btn primary" href="/notifications">
          Back to Notifications
        </Link>
      }
    />
  );
}

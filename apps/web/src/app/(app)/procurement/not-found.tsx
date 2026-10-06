import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

export default function ProcurementNotFound() {
  // GAP-PROCUREMENT-HOME-04: give the 404 an action, matching error.tsx's
  // "Back to Procurement" affordance, so a mistyped /procurement/* URL is a
  // dead end no longer. EmptyState's `action` slot is keyboard-focusable.
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={
        <Link href="/procurement" className="btn primary">
          Back to Procurement
        </Link>
      }
    />
  );
}

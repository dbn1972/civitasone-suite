"use client";

import { RouteError } from "@/app/_components/RouteError";

/**
 * GAP-INSPECTION-HOME-04: the inspection module had no error boundary of its
 * own, so a thrown render error fell through to a generic ancestor. Uses the
 * standard RouteError (same pattern as install/error.tsx) with a back link to
 * the dashboard.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} backHref="/dashboard" backLabel="Back to dashboard" area="Inspection page" />;
}

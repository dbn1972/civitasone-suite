"use client";

import { RouteError } from "@/app/_components/RouteError";

/**
 * GAP-POLICY-HOME-03: a module-level error boundary so a thrown loader error in
 * any /policy route renders a scoped "Back to Policy" error state instead of
 * falling through to the app-level boundary. Mirrors procurement/error.tsx.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/policy"
      backLabel="Back to Policy"
      area="Policy page"
    />
  );
}

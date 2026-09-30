"use client";

import { RouteError } from "@/app/_components/RouteError";

/** GAP-HR-APAR-07: page-specific error area instead of the generic "HR page". */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr"
      backLabel="Back to HR"
      area="APAR"
    />
  );
}

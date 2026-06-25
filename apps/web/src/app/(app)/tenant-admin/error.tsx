"use client";

import { useEffect } from "react";
import { EmptyState } from "../../_components/ds";

/**
 * Module-level error boundary for every tenant-admin route. Renders an
 * accessible alert region with a retry control so a failed data load never
 * leaves the user on a blank screen.
 */
export default function TenantAdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for observability without leaking details to the UI.
    console.error("tenant-admin route error:", error);
  }, [error]);

  return (
    <div className="wrap">
      <div role="alert" aria-live="assertive">
        <EmptyState
          icon="⚠️"
          title="Something went wrong"
          message="We couldn't load this tenant-admin view. Please try again — if the problem persists, contact your platform administrator."
          action={
            <button type="button" className="btn primary" onClick={() => reset()} style={{ marginTop: 12 }}>
              Try again
            </button>
          }
        />
      </div>
    </div>
  );
}

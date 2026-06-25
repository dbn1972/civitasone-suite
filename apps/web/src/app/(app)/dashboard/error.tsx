"use client";

import { useEffect } from "react";
import { EmptyState } from "../../_components/ds";
import { Button } from "@civitasone/ui-kit";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert">
      <div className="card">
        <div className="pad">
          <EmptyState
            icon="⚠️"
            title="Could not load your command center"
            message="Something went wrong while loading the dashboard. You can retry, or head to your approvals queue."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <Button onClick={() => reset()}>Try again</Button>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

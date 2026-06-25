"use client";

import { useEffect } from "react";
import { EmptyState } from "../../_components/ds";

export default function HelpdeskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Helpdesk module error:", error);
  }, [error]);

  return (
    <div style={{ padding: "24px 0" }}>
      <EmptyState
        icon="⚠️"
        title="Something went wrong"
        message="The Helpdesk module hit an unexpected error. You can retry, or head back to the dashboard."
        action={
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button type="button" className="btn primary" onClick={reset}>Try again</button>
            <a className="btn ghost" href="/helpdesk">Go to Helpdesk</a>
          </div>
        }
      />
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { EmptyState } from "@/app/_components/ds";

export default function GrantDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Grant detail error:", error);
  }, [error]);

  return (
    <div role="alert" style={{ padding: "24px 0" }}>
      <EmptyState
        icon="⚠️"
        title="Something went wrong"
        message={
          error.message ||
          "This grant could not be loaded. You can retry, or return to the grants list."
        }
        action={
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button type="button" className="btn primary" onClick={reset}>
                Try again
              </button>
              <a className="btn ghost" href="/grants">
                All Grants
              </a>
            </div>
            {error.digest ? (
              <p style={{ fontSize: 12, color: "var(--muted, #64748b)", margin: 0 }}>
                Error ID: {error.digest}
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

"use client";

import { ErrorState } from "../../_components/ds";

export default function ApprovalsError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      error={{
        what: "Something went wrong.",
        next: "We couldn't load your approvals. This is usually a temporary issue — please try again.",
        actions: ["retry", "back", "help"],
      }}
      onRetry={reset}
      backHref="/dashboard"
      helpHref="/help/approvals"
    />
  );
}

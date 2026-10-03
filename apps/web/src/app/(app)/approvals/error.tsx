"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ApprovalsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError error={error} reset={reset} backHref="/dashboard" backLabel="Back to dashboard" area="approvals" />
  );
}

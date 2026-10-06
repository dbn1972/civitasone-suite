"use client";

import { RouteError } from "@/app/_components/RouteError";

// GAP-CRM-RTI-NEW-06: the new-request route inherited rti/error.tsx (area "RTI
// Requests", back to /crm), which reads as the register failing rather than the
// form. Give it its own boundary scoped to the new-request flow.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/crm/rti"
      backLabel="Back to RTI Requests"
      area="New RTI request"
    />
  );
}

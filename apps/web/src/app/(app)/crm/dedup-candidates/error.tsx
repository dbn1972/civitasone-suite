"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function DedupCandidatesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/crm/data-quality"
      backLabel="Back to Data Quality"
      area="Duplicate Candidates"
    />
  );
}

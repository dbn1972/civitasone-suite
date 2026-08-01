"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/estab/quarters/allotments"
      backLabel="Back to Allotments"
      area="Allotment Detail"
    />
  );
}

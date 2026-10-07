"use client";

import { RouteError } from "@/app/_components/RouteError";

// GAP-MUNICIPAL-HOME-05: give the municipal segment its own error boundary with
// a real retry and a back link to the hub, instead of falling through to the
// generic (app)/error.tsx.
export default function MunicipalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/municipal"
      backLabel="Back to Municipal Services"
      area="Municipal Services page"
    />
  );
}

"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/revenue/waivers"
      backLabel="Back to Waivers"
      area="Decide Waiver"
    />
  );
}

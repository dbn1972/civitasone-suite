"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/helpdesk/internal"
      backLabel="Back to Helpdesk"
      area="Helpdesk [Id]"
    />
  );
}

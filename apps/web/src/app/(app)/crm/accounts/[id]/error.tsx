"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/crm/accounts"
      backLabel="Back"
      area="CRM [Id]"
    />
  );
}

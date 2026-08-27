"use client";

import { RouteError } from "@/app/_components/RouteError";

export default function AppError({
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
      backHref="/dashboard"
      backLabel="Back to Dashboard"
      area="page"
    />
  );
}

"use client";

import { RouteError } from "@/app/_components/RouteError";

// GAP-PLATFORM-ADMIN-HOME-05: a segment-local error boundary so a thrown
// error in any platform-admin page offers Retry and a "Back to Platform
// Admin" link, rather than falling through to the generic app boundary that
// sends the user back to /dashboard with a generic "page" label.
export default function PlatformAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/platform-admin"
      backLabel="Back to Platform Admin"
      area="Platform admin"
    />
  );
}

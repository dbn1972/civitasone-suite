"use client";

import { RouteError } from "@/app/_components/RouteError";

/** Public careers error boundary (GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-06): retry plus a way back to the vacancy list. */
export default function CareersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} backHref="/careers" backLabel="Back to careers" area="Careers" />;
}

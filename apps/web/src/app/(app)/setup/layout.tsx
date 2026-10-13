import type { ReactNode } from "react";

/**
 * SF-20: intentionally open to every signed-in user. "Getting Started" is in everyone's sidebar,
 * and the wizard only shows progress derived from reads that tenant-service and the module
 * services scope per caller (GET /v1/tenants/current is "any authenticated actor"). The write
 * actions inside (sample data) are gated by their own services (e.g. location-service
 * LOCATION_ROLES), so the layout adds no role floor.
 */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

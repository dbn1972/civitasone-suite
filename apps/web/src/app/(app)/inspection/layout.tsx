import type { ReactNode } from "react";
import { requireAnyRole, INSPECTION_ROLES } from "@/lib/auth/roleGuard";

export default function InspectionLayout({ children }: { children: ReactNode }) {
  // Gate the /inspection route family to the roles inspection-service actually
  // admits (INSPECTION_ROLES mirrors its route guards). The service is the
  // authority; this redirects a role with no inspection permission to the
  // dashboard instead of rendering a hub whose calls all 403.
  requireAnyRole(INSPECTION_ROLES);
  return children;
}

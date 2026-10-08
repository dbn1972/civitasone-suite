import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

// GAP2-LOCATIONS-HOME-02: the /locations segment (hub + geofences,
// jurisdictions, infrastructure, monitoring-map) had NO layout and NO web-side
// role gate, so any authenticated user could open it — the server 403s the data
// fetches, so the page flashed the hub then rendered an error card. This gate
// mirrors location-service's broadest view role set
// (LOCATION_VIEW_ROLES in services/location-service/src/modules/locations/routes.ts:
//  location_user/location_admin/super_admin/admin/hr_admin + hr_officer/manager/
//  employee), so a user with none of those roles is redirected to /dashboard
// instead of being shown a hub whose calls will 403. The service remains the
// real authority; this is defence-in-depth + honest UX. Child routes
// (infrastructure/land-records) gate more strictly server-side still.
const LOCATION_VIEW_ROLES = [
  "location_user",
  "location_admin",
  "super_admin",
  "admin",
  "hr_admin",
  "hr_officer",
  "manager",
  "employee",
];

export default function LocationsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(LOCATION_VIEW_ROLES);
  return <ModuleGate moduleKey="locations">{children}</ModuleGate>;
}

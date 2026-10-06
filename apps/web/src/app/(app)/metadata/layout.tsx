import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, METADATA_ADMIN_ROLES } from "@/lib/auth/roleGuard";

export default function MetadataLayout({ children }: { children: ReactNode }) {
  // GAP-METADATA-HOME-01: the /metadata segment configures tenant-wide,
  // schema-changing structures (entities, fields, validation rules, records,
  // forms) yet had no layout and no gate — any signed-in user could open it and
  // only hit failed fetches. metadata-service enforces its ADMIN role set on
  // every /v1/metadata/* route (verified); this mirrors that set
  // (METADATA_ADMIN_ROLES) so an unauthorised user is redirected to /dashboard
  // instead of being shown a hub whose every call will 403. The service remains
  // the real authority; this is defence-in-depth + honest UX.
  requireAnyRole(METADATA_ADMIN_ROLES);
  return <ModuleGate moduleKey="metadata">{children}</ModuleGate>;
}

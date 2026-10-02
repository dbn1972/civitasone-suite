import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewLocationPageClient } from "./NewLocationPageClient";
import { fetchJson } from "@/app/_data/apiClient";
import type { MinimalLocation } from "./AddLocationForm";

/**
 * Mirrors services/location-service/src/modules/locations/routes.ts's
 * LOCATION_ROLES guard on POST /v1/locations exactly (locations are owned
 * by location-service, not hrms-service -- this is a different role set
 * than hr/departments/new or hr/designations/new use).
 *
 * hr/layout.tsx deliberately admits every HR-adjacent role (including plain
 * "employee") into this whole /hr tree -- each page is responsible for its
 * own finer-grained check. Without this one, a role like "employee" reached
 * a fully working "Add Location" form with no indication it would ever
 * work; the backend correctly rejected the submit with 403, but only after
 * the user filled it in.
 */
const LOCATION_ADMIN_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

/**
 * GAP-HR-LOCATIONS-NEW-01: the parent-location select needs the existing
 * location list. Best-effort only -- a fetch failure here should not block
 * the whole "Add Location" form; it just means the parent select falls back
 * to "None (top level)" only, same as departments/new/page.tsx's
 * getDepartments().
 */
async function getLocations(): Promise<MinimalLocation[]> {
  const result = await fetchJson<unknown, MinimalLocation[]>("/api/v1/locations?limit=500", [], {
    telemetryKey: "config.locations.new",
    mapResponse: (p) => (p as { data: MinimalLocation[] })?.data ?? null,
  });
  return result.source === "error" ? [] : result.data;
}

export default async function NewLocationPage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => LOCATION_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="adding a location" requiredRoles={LOCATION_ADMIN_ROLES} />;
  }

  const locations = await getLocations();
  return <NewLocationPageClient locations={locations} />;
}

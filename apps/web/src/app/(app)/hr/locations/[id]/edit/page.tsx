import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { LoadErrorState, PageHeader } from "../../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { selectableParents } from "../../locationTree";
import { EditLocationPageClient } from "./EditLocationPageClient";

/**
 * GAP-HR-LOCATIONS-02: edit a location. Same role set as the create page
 * (PATCH /v1/locations/:id is guarded by location-service's LOCATION_ROLES).
 */
const LOCATION_ADMIN_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

type Loc = {
  id: string; name: string; type: string; parentId: string | null; status?: string;
  addressLine: string | null; city: string | null; postalCode: string | null; lgdCode: string | null;
};

export default async function EditLocationPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("addLocationForm");
  const roles = getSessionRoles();
  if (!roles.some((r) => LOCATION_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="editing a location" requiredRoles={LOCATION_ADMIN_ROLES} />;
  }

  const [one, all] = await Promise.all([
    fetchJson<unknown, Loc | null>(`/api/v1/locations/${encodeURIComponent(params.id)}`, null, {
      telemetryKey: "config.locations.edit",
      mapResponse: (p) => (p && typeof p === "object" ? (p as Loc) : null),
    }),
    fetchJson<unknown, Loc[]>("/api/v1/locations?limit=500", [], {
      telemetryKey: "config.locations.edit.list",
      mapResponse: (p) => (p as { data?: Loc[] })?.data ?? null,
    }),
  ]);

  const loc = one.data;
  if (!loc) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("editNotFoundTitle")} back="/hr/locations" backLabel={t("pageBackLabel")} />
        <LoadErrorState result={one} area="location" backHref="/hr/locations" requiredRoles={LOCATION_ADMIN_ROLES} />
      </div>
    );
  }

  const parents = all.source === "error" ? [] : selectableParents(all.data, loc.id);
  return (
    <EditLocationPageClient
      editing={{
        id: loc.id, name: loc.name, type: loc.type, parentId: loc.parentId ?? null,
        addressLine: loc.addressLine ?? null, city: loc.city ?? null, postalCode: loc.postalCode ?? null, lgdCode: loc.lgdCode ?? null,
      }}
      parents={parents.map((p) => ({ id: p.id, name: p.name, type: p.type, parentId: p.parentId ?? null }))}
    />
  );
}

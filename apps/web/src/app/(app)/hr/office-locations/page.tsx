import { PageHeader, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { OfficeLocationForm } from "./OfficeLocationForm";

/**
 * GAP-HR-LOCATIONS-NEW-02: admin screen for the HRMS geofence master
 * (hrms_office_locations). Mirrors the backend's own HR_ROLES on POST
 * /v1/hrms/office-locations exactly (geo-attendance/routes.ts) -- hr/layout
 * admits far more roles than may create a geofence.
 */
const OFFICE_LOCATION_ADMIN_ROLES = ["super_admin", "admin", "hr_admin"];

type OfficeLocation = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
};

type Row = {
  id: string;
  name: string;
  address: string;
  coordinates: string;
  radius: string;
  status: string;
} & Record<string, unknown>;

async function getOfficeLocations(): Promise<LoaderResult<OfficeLocation[]>> {
  return fetchJson<unknown, OfficeLocation[]>("/api/v1/hrms/office-locations", [], {
    telemetryKey: "hr.office_locations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: OfficeLocation[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OfficeLocationsPage() {
  const t = await getTranslations("officeLocations");
  const roles = getSessionRoles();
  if (!roles.some((r) => OFFICE_LOCATION_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="office locations" requiredRoles={OFFICE_LOCATION_ADMIN_ROLES} backHref="/hr" backLabel="Back to HR" />;
  }

  const result = await getOfficeLocations();
  const errored = result.source === "error";
  const rows: Row[] = result.data.map((o) => ({
    id: o.id,
    name: o.name,
    address: o.address ?? "—",
    coordinates: `${o.latitude}, ${o.longitude}`,
    radius: t("radiusValue", { meters: o.radiusMeters }),
    status: o.isActive ? "active" : "inactive",
  }));

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: t("colName") },
    { key: "address", label: t("colAddress") },
    { key: "coordinates", label: t("colCoordinates") },
    { key: "radius", label: t("colRadius") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={result.source} message={t("dataSourceErrorMessage")} />
      <Card title={t("listTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="office locations" backHref="/hr" requiredRoles={OFFICE_LOCATION_ADMIN_ROLES} />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={rows}
            pageSize={15}
            emptyIcon="📍"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
      <OfficeLocationForm />
    </div>
  );
}

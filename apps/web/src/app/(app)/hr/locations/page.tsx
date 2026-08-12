import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Location = {
  id: string;
  name: string;
  type: string;
  addressLine?: string;
  city?: string;
  postalCode?: string;
  lgdCode?: string;
  parentId?: string;
} & Record<string, unknown>;

async function getLocations(): Promise<LoaderResult<Location[]>> {
  try {
    const r = await fetchJson<unknown, Location[]>("/api/v1/locations", [], {
      telemetryKey: "config.locations",
      mapResponse: (p) => (p as { data: Location[] })?.data ?? null,
    });
    return r;
  } catch {
    return { data: [], source: "error" as const };
  }
}

const newBtnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  background: "var(--primary)",
  color: "#fff",
  textDecoration: "none",
};

export default async function LocationsPage() {
  const { data: locations, source } = await getLocations();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Locations"
        subtitle="Offices, branches, and facilities registered in the system. Add locations so employees and operations can be correctly assigned."
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={
          <Link href="/hr/locations/new" style={newBtnStyle}>
            + New Location
          </Link>
        }
      />
      <DataSourceBadge source={source} />
      <Card title={`Locations (${locations.length})`}>
        {locations.length === 0 ? (
          <EmptyState
            icon="📍"
            title="No locations yet"
            message="Register your first office, branch, or facility."
          />
        ) : (
          <DataTable<Location>
            columns={[
              { key: "name", label: "Name" },
              { key: "type", label: "Type" },
              { key: "city", label: "City" },
              { key: "postalCode", label: "Postal Code" },
            ]}
            rows={locations}
            sortable
            filterable
            filterPlaceholder="Search locations…"
            emptyIcon="📍"
            emptyTitle="No match"
            emptyMessage="Try a different search."
          />
        )}
      </Card>
    </main>
  );
}

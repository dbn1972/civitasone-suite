import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Location = {
  id: string;
  name: string;
  type: string;
  addressLine?: string;
  city?: string;
  state?: string;
  district?: string;
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

/** MapPin icon as inline SVG (lucide-react compatible). */
function MapPin({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: "middle" }}
    >
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export default async function LocationsPage() {
  const { data: locations, source } = await getLocations();

  const stateCount    = locations.filter((l) => l.type === "state").length;
  const districtCount = locations.filter((l) => l.type === "district").length;
  const blockCount    = locations.filter((l) => !["state", "district"].includes(l.type)).length;

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
      <StatGrid>
        <StatCard icon="🌍" iconBg="#e6f0ff" label="Total Locations" value={locations.length} />
        <StatCard icon="🏛️" iconBg="#e6f7f0" label="State-level"     value={stateCount} />
        <StatCard icon="🏙️" iconBg="#fff7e6" label="District-level"  value={districtCount} />
        <StatCard icon="🏘️" iconBg="#f5f5f5" label="Block / Other"   value={blockCount} />
      </StatGrid>
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
              {
                key: "name",
                label: "Name",
                render: (row) => (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={13} color="var(--primary,#2563eb)" />
                    <span style={{ fontWeight: 500 }}>{row.name}</span>
                  </span>
                ),
              },
              { key: "type", label: "Type" },
              {
                key: "state",
                label: "State",
                render: (row) => (
                  <span>
                    {row.state ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {String(row.state)}
                      </span>
                    ) : "—"}
                  </span>
                ),
              },
              {
                key: "district",
                label: "District",
                render: (row) => (
                  <span>
                    {row.district ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: "#f0fdf4",
                          color: "#15803d",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {String(row.district)}
                      </span>
                    ) : "—"}
                  </span>
                ),
              },
              { key: "city",       label: "City" },
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

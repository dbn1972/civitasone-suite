import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("locations");
  const { data: locations, source } = await getLocations();

  const errored = source === "error";
  const stateCount    = locations.filter((l) => l.type === "state").length;
  const districtCount = locations.filter((l) => l.type === "district").length;
  const blockCount    = locations.filter((l) => !["state", "district"].includes(l.type)).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          <Link href="/hr/locations/new" style={newBtnStyle}>
            {t("newBtn")}
          </Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🌍" iconBg="#e6f0ff" label={t("statTotalLabel")} value={errored ? "—" : locations.length} />
        <StatCard icon="🏛️" iconBg="#e6f7f0" label={t("statStateLabel")}     value={errored ? "—" : stateCount} />
        <StatCard icon="🏙️" iconBg="#fff7e6" label={t("statDistrictLabel")}  value={errored ? "—" : districtCount} />
        <StatCard icon="🏘️" iconBg="#f5f5f5" label={t("statBlockLabel")}   value={errored ? "—" : blockCount} />
      </StatGrid>
      <Card title={t("cardTitleWithCount", { count: locations.length })}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "locations" })} backHref="/hr" />
        ) : locations.length === 0 ? (
          <EmptyState
            icon="📍"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<Location>
            columns={[
              {
                key: "name",
                label: t("colName"),
                render: (row) => (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={13} color="var(--primary,#2563eb)" />
                    <span style={{ fontWeight: 500 }}>{row.name}</span>
                  </span>
                ),
              },
              { key: "type", label: t("colType") },
              {
                key: "state",
                label: t("colState"),
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
                label: t("colDistrict"),
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
              { key: "city",       label: t("colCity") },
              { key: "postalCode", label: t("colPostalCode") },
            ]}
            rows={locations}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="📍"
            emptyTitle={t("noMatchTitle")}
            emptyMessage={t("noMatchMessage")}
          />
        )}
      </Card>
    </main>
  );
}

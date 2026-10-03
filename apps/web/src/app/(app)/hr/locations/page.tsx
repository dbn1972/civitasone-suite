import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { LocationRowActions } from "./LocationRowActions";

// This list page used to render "Add Location" for every viewer regardless
// of role -- unlike every sibling admin-create screen in this module
// (departments, designations, jd-templates, training, pensioners), which
// only show their own create button to roles that can actually complete it.
// A non-admin clicking through landed on /hr/locations/new only to be
// turned away by that page's own LOCATION_ADMIN_ROLES gate (its POST
// /v1/locations guard, owned by location-service). Mirrors that list
// exactly, checked here before rendering the button and the row actions
// (GAP-HR-LOCATIONS-02: archive is the same admin-only action).
const LOCATION_ADMIN_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

// Kept local (not extracted to a file shared with locations/new/AddLocationForm.tsx)
// so this fix stays inside this page's own files -- see GAP-HR-LOCATIONS-05.
// Matches AddLocationForm.tsx's LOCATION_TYPES value set; those labels are
// themselves plain hardcoded English (not run through next-intl either).
const LOCATION_TYPE_LABELS: Record<string, string> = {
  state: "State",
  district: "District",
  block: "Block",
  ward: "Ward",
  office: "Office",
  facility: "Facility",
  branch: "Branch",
};

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
  status?: string;
} & Record<string, unknown>;

async function getLocations(): Promise<LoaderResult<Location[]>> {
  // fetchJson already catches every failure mode (network error, non-2xx,
  // invalid payload) and returns { source: "error", status, errorMessage }
  // itself (apiClient.ts:131-173) -- the try/catch this function used to
  // wrap around it was dead code that could only ever hide a bug, never
  // handle one (GAP-HR-LOCATIONS-07). Removed; the full result (incl.
  // status/errorMessage) is now propagated instead of being narrowed away.
  return fetchJson<unknown, Location[]>("/api/v1/locations", [], {
    telemetryKey: "config.locations",
    mapResponse: (p) => (p as { data: Location[] })?.data ?? null,
  });
}

/**
 * Fills State/District for any row whose parentId chain leads to one, when
 * the API response doesn't already carry it directly (GAP-HR-LOCATIONS-01).
 * This only helps rows that already have a parentId (e.g. created via the
 * sibling /locations/list "Create Branch Office" form, which does send
 * parentId -- see LocationActions.tsx). Letting *this* page's own "New
 * Location" form set a parent is GAP-HR-LOCATIONS-NEW-01, a different page,
 * out of scope here -- so this is a real but partial fix: it displays
 * hierarchy wherever one already exists, but doesn't yet let every creation
 * path set one.
 */
function withDerivedHierarchy(rows: Location[]): Location[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  function ancestorOfType(row: Location, type: string, depth: number): string | undefined {
    if (depth > 10) return undefined; // guard against a parentId cycle in bad data
    if (row.type === type) return row.name;
    if (!row.parentId) return undefined;
    const parent = byId.get(row.parentId);
    return parent ? ancestorOfType(parent, type, depth + 1) : undefined;
  }
  return rows.map((r) => ({
    ...r,
    state: r.state ?? ancestorOfType(r, "state", 0),
    district: r.district ?? ancestorOfType(r, "district", 0),
  }));
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
  const roles = getSessionRoles();
  const canManage = roles.some((r) => LOCATION_ADMIN_ROLES.includes(r));
  const { data: rawLocations, source, status, errorMessage } = await getLocations();

  const errored = source === "error";
  const locations = errored ? rawLocations : withDerivedHierarchy(rawLocations);
  const stateCount    = locations.filter((l) => l.type === "state").length;
  const districtCount = locations.filter((l) => l.type === "district").length;
  const blockCount    = locations.filter((l) => !["state", "district"].includes(l.type)).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          canManage ? (
            <Link href="/hr/locations/new" style={newBtnStyle}>
              {t("newBtn")}
            </Link>
          ) : undefined
        }
      />
      {/* GAP-HR-LOCATIONS-04: this used to render unconditionally alongside
          RefreshErrorState on failure, announcing the same failure twice.
          Now shown only on the success path; the error path below uses the
          role/403-aware LoadErrorState instead of the always-retryable
          RefreshErrorState (same component GAP-HR-PAY-MATRIX-02 adopts for
          the same reason). */}
      {!errored ? <DataSourceBadge source={source} /> : null}
      <StatGrid>
        <StatCard icon="🌍" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : locations.length} />
        <StatCard icon="🏛️" iconBg="var(--goodbg, #e6f7f0)" label={t("statStateLabel")}     value={errored ? "—" : stateCount} />
        <StatCard icon="🏙️" iconBg="var(--warnbg, #fff7e6)" label={t("statDistrictLabel")}  value={errored ? "—" : districtCount} />
        <StatCard icon="🏘️" iconBg="var(--bg, #f5f5f5)" label={t("statBlockLabel")}   value={errored ? "—" : blockCount} />
      </StatGrid>
      <Card title={errored ? t("cardTitle") : t("cardTitleWithCount", { count: locations.length })}>
        {errored ? (
          <LoadErrorState result={{ status, errorMessage }} area="locations" backHref="/hr" />
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
                    {/* GAP-HR-LOCATIONS-03: name opens the per-location page (employees assigned here). */}
                    <Link href={`/hr/locations/${row.id}`} style={{ fontWeight: 500 }}>{row.name}</Link>
                  </span>
                ),
              },
              {
                // GAP-HR-LOCATIONS-05: this column used to have no `render`,
                // so DataTable printed the raw lowercase enum value (e.g.
                // "facility") instead of a human label. (The stat-tile part
                // of this item's original claim -- tile counts not summing
                // to total, and an un-honest "Block" label -- was checked
                // against current source and found already correct: the
                // label already reads "Block / Other" and blockCount is
                // defined as everything-not-state-or-district, so the three
                // tiles already sum to the total by construction. Only this
                // column render was actually missing.)
                key: "type",
                label: t("colType"),
                render: (row) => <span>{LOCATION_TYPE_LABELS[row.type] ?? row.type}</span>,
              },
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
                          background: "var(--infobg, #eff6ff)",
                          color: "var(--info, #1d4ed8)",
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
                          background: "var(--goodbg, #f0fdf4)",
                          color: "var(--good, #15803d)",
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
              {
                // GAP-HR-LOCATIONS-01 fix step 3: lgdCode was collected on
                // create but never shown anywhere.
                key: "lgdCode",
                label: t("colLgdCode"),
                render: (row) => <span>{row.lgdCode || "—"}</span>,
              },
              {
                // GAP-HR-LOCATIONS-02 fix step 3: show archived rows (via a
                // status column) rather than the read-only register having
                // no status/lifecycle visibility at all. Sortable/filterable
                // text lets a viewer type "archived" to isolate them, since
                // this page doesn't yet have a dedicated status filter
                // control.
                key: "status",
                label: t("colStatus"),
                render: (row) => {
                  const archived = row.status === "archived";
                  return (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: archived ? "var(--bg, #f1f5f9)" : "var(--goodbg, #f0fdf4)",
                        color: archived ? "var(--slate, #64748b)" : "var(--good, #15803d)",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {archived ? "Archived" : "Active"}
                    </span>
                  );
                },
              },
              ...(canManage
                ? [
                    {
                      key: "actions",
                      label: "",
                      render: (row: Location) => <LocationRowActions id={row.id} name={row.name} archived={row.status === "archived"} />,
                    },
                  ]
                : []),
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
    </div>
  );
}

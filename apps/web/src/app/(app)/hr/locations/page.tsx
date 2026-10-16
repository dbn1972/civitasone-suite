import Link from "next/link";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { LocationsTable, type Location } from "./LocationsTable";

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
  color: "var(--panel)",
  textDecoration: "none",
};


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
    <div className="page-main wrap">
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
        <StatCard icon="🌍" iconBg="var(--infobg)" label={t("statTotalLabel")} value={errored ? "—" : locations.length} />
        <StatCard icon="🏛️" iconBg="var(--goodbg)" label={t("statStateLabel")}     value={errored ? "—" : stateCount} />
        <StatCard icon="🏙️" iconBg="var(--warnbg)" label={t("statDistrictLabel")}  value={errored ? "—" : districtCount} />
        <StatCard icon="🏘️" iconBg="var(--bg)" label={t("statBlockLabel")}   value={errored ? "—" : blockCount} />
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
          <LocationsTable
            locations={locations}
            canManage={canManage}
            labels={{ colCity: t("colCity"), colDistrict: t("colDistrict"), colLgdCode: t("colLgdCode"), colName: t("colName"), colPostalCode: t("colPostalCode"), colState: t("colState"), colStatus: t("colStatus"), colType: t("colType"), filterPlaceholder: t("filterPlaceholder"), noMatchMessage: t("noMatchMessage"), noMatchTitle: t("noMatchTitle") }}
          />
        )}
      </Card>
    </div>
  );
}

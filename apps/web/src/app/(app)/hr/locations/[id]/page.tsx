import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, LoadErrorState } from "../../../../_components/ds";
import { LocationEmployeesTable, type LocationEmployeeRow } from "./LocationEmployeesTable";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { humanizeStatus } from "@/lib/formatters";
import {
  PAGE_SIZE,
  STATUS_OPTIONS,
  capitalise,
  detailHref,
  employeesQuery,
  pageWindow,
  panelState,
  parseDetailParams,
} from "./locationDetailView";

// GAP-HR-LOCATIONS-03: per-location page listing the tenant's employees
// assigned to that location (hrms_employees.location_id, set by the location
// picker on the employee form). Employees whose location is free text only are
// not listed here; the API reports how many there are so we can say so.

type LocationView = {
  id: string;
  name: string;
  type: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  lgdCode: string | null;
  parentId: string | null;
  status: string;
};
type Hierarchy = { location: LocationView; ancestors: LocationView[]; children: LocationView[]; descendantIds: string[] };

type EmployeesPayload = { data: LocationEmployeeRow[]; total: number; limit: number; offset: number; unlinkedCount: number };

const EMPTY_EMPLOYEES: EmployeesPayload = { data: [], total: 0, limit: PAGE_SIZE, offset: 0, unlinkedCount: 0 };

async function getHierarchy(id: string): Promise<LoaderResult<Hierarchy | null>> {
  return fetchJson<Hierarchy, Hierarchy | null>(`/api/v1/locations/${encodeURIComponent(id)}/hierarchy`, null, {
    telemetryKey: "hr.location.hierarchy",
    mapResponse: (p) => (p && typeof p === "object" && (p as Hierarchy).location ? (p as Hierarchy) : null),
  });
}

async function getLocationEmployees(id: string, qs: string): Promise<LoaderResult<EmployeesPayload>> {
  return fetchJson<EmployeesPayload, EmployeesPayload>(
    `/api/v1/hrms/locations/${encodeURIComponent(id)}/employees?${qs}`,
    EMPTY_EMPLOYEES,
    {
      telemetryKey: "hr.location.employees",
      mapResponse: (p) => (p && Array.isArray((p as EmployeesPayload).data) ? (p as EmployeesPayload) : null),
    },
  );
}

const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" };

export default async function LocationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("locationDetail");
  const p = parseDetailParams(searchParams);
  const [hier, emps] = await Promise.all([getHierarchy(params.id), getLocationEmployees(params.id, employeesQuery(p))]);

  if (hier.status === 404) notFound();
  if (hier.source === "error" || !hier.data) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("fallbackTitle")} back="/hr/locations" backLabel={t("backLabel")} help="hr" />
        <LoadErrorState result={{ status: hier.status, errorMessage: hier.errorMessage }} area="location" backHref="/hr/locations" backLabel={t("backLabel")} />
      </div>
    );
  }

  const { location, ancestors, children } = hier.data;
  const filtered = p.q !== "" || p.status !== "active";
  const state = panelState(emps.source, emps.data.data.length, filtered);
  const win = pageWindow(emps.data.total, p.page);
  const address = [location.addressLine, location.city, location.postalCode].filter(Boolean).join(", ");
  const statusLabel = location.status === "active" ? t("statusActive") : humanizeStatus(location.status);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={location.name} subtitle={t("subtitle")} back="/hr/locations" backLabel={t("backLabel")} help="hr" />

      <nav aria-label={t("breadcrumbLabel")} style={{ marginBottom: 12, fontSize: 13 }}>
        <ol style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
          <li><Link href="/hr/locations">{t("breadcrumbRoot")}</Link></li>
          {ancestors.map((a) => (
            <li key={a.id}>
              <span aria-hidden="true">/ </span>
              <Link href={`/hr/locations/${a.id}`}>{a.name}</Link>
            </li>
          ))}
          <li aria-current="page">
            <span aria-hidden="true">/ </span>
            {location.name}
          </li>
        </ol>
      </nav>

      <Card title={t("detailsTitle")}>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, margin: 0 }}>
          <div><dt style={{ color: "var(--mut)", fontSize: 12 }}>{t("typeLabel")}</dt><dd style={{ margin: 0 }}>{capitalise(location.type)}</dd></div>
          <div><dt style={{ color: "var(--mut)", fontSize: 12 }}>{t("statusLabel")}</dt><dd style={{ margin: 0 }}>{statusLabel}</dd></div>
          <div><dt style={{ color: "var(--mut)", fontSize: 12 }}>{t("addressLabel")}</dt><dd style={{ margin: 0 }}>{address || "—"}</dd></div>
          <div><dt style={{ color: "var(--mut)", fontSize: 12 }}>{t("lgdLabel")}</dt><dd style={{ margin: 0 }}>{location.lgdCode || "—"}</dd></div>
        </dl>
      </Card>

      <Card title={t("subLocationsTitle", { count: children.length })}>
        {children.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/hr/locations/${c.id}`}>{c.name}</Link> <span style={{ color: "var(--mut)" }}>({capitalise(c.type)})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "var(--mut)" }}>{t("subLocationsNone")}</p>
        )}
      </Card>

      <Card title={emps.source === "error" ? t("employeesTitle") : t("employeesTitleWithCount", { count: emps.data.total })}>
        <form method="GET" role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <label htmlFor="loc-emp-search" style={srOnly}>{t("searchLabel")}</label>
          <input
            id="loc-emp-search"
            type="search"
            name="q"
            defaultValue={p.q}
            placeholder={t("searchPlaceholder")}
            style={{ flex: "1 1 220px", maxWidth: 360, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, fontSize: 14 }}
          />
          <label htmlFor="loc-emp-status" style={srOnly}>{t("statusFilterLabel")}</label>
          <select id="loc-emp-status" name="status" defaultValue={p.status} style={{ minHeight: 40, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "active" ? t("statusOptActive") : s === "all" ? t("statusOptAll") : humanizeStatus(s)}</option>
            ))}
          </select>
          <label htmlFor="loc-emp-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, minHeight: 40 }}>
            <input id="loc-emp-sub" type="checkbox" name="sub" value="1" defaultChecked={p.includeSub} style={{ width: 18, height: 18 }} />
            {t("includeSub")}
          </label>
          <button type="submit" className="btn">{t("applyBtn")}</button>
          {filtered || p.includeSub ? <Link href={`/hr/locations/${location.id}`} className="btn ghost">{t("clearFilters")}</Link> : null}
        </form>

        {/* Organisation-wide figure, so only shown on top-level locations (a sub-location page would imply it is about that place). */}
        {emps.source !== "error" && !location.parentId && emps.data.unlinkedCount > 0 ? (
          <p role="note" style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
            {t("unlinkedNote", { count: emps.data.unlinkedCount })}
          </p>
        ) : null}

        {state === "error" ? (
          <LoadErrorState result={{ status: emps.status, errorMessage: emps.errorMessage }} area="employees at this location" backHref="/hr/locations" backLabel={t("backLabel")} />
        ) : (
          <LocationEmployeesTable
            rows={emps.data.data}
            labels={{
              colName: t("colName"),
              colEmpNo: t("colEmpNo"),
              colDesignation: t("colDesignation"),
              colDepartment: t("colDepartment"),
              caption: t("caption", { name: location.name }),
              emptyIcon: state === "no-match" ? "🔍" : "👥",
              emptyTitle: state === "no-match" ? t("noMatchTitle") : t("emptyTitle"),
              emptyMessage: state === "no-match" ? t("noMatchMessage") : t("emptyMessage"),
            }}
          />
        )}

        {state !== "error" && win.needsPaging ? (
          <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
            {win.hasPrev ? <Link href={detailHref(location.id, { ...p, page: p.page - 1 })} className="btn">{"←"} {t("prevLabel")}</Link> : null}
            <span style={{ color: "var(--ink2)" }}>{t("showingRange", { from: win.from, to: win.to, total: emps.data.total })}</span>
            {win.hasNext ? <Link href={detailHref(location.id, { ...p, page: p.page + 1 })} className="btn">{t("nextLabel")} {"→"}</Link> : null}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}

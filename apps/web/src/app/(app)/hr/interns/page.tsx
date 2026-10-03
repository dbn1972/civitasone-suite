import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { mapInterns, isRegisterCapped, INTERN_TYPES_QUERY, INTERNS_PAGE_LIMIT, type ApiApprenticeship, type ApiEmployee, type InternRow as Row } from "./internsModel";
import { getTranslations } from "next-intl/server";

const EMPTY_APPRENTICESHIPS: ApiApprenticeship[] = [];

/**
 * GAP-HR-WORKFORCE-INTERNS-01: the stipend/period columns come from the
 * apprenticeship engagements (apprentices only). That is a second, best-effort
 * read: if it fails the register still renders from the employee list, with
 * the stipend/period cells as an em dash and a visible "details unavailable"
 * note -- never a fabricated zero.
 */
async function getInterns(): Promise<LoaderResult<Row[]> & { enrichmentFailed: boolean; capped: boolean }> {
  // GAP-HR-INTERNS-03: the intern/apprentice filter used to run client-side
  // over the first 200 employees of the whole tenant, so on any larger
  // workforce the register silently omitted interns. One server-side request
  // now filters on every type the model accepts (multi-value, case-insensitive).
  const [emps, appr] = await Promise.all([
    fetchJson<unknown, ApiEmployee[]>(`/api/v1/hrms/employees?employeeType=${INTERN_TYPES_QUERY}&limit=${INTERNS_PAGE_LIMIT}`, [], {
      telemetryKey: "hr.interns",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
        return Array.isArray(arr) ? (arr as ApiEmployee[]) : null;
      },
    }),
    fetchJson<unknown, ApiApprenticeship[]>("/api/v1/hrms/apprenticeships", EMPTY_APPRENTICESHIPS, {
      telemetryKey: "hr.interns.apprenticeships",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: ApiApprenticeship[] })?.data;
        return Array.isArray(arr) ? (arr as ApiApprenticeship[]) : null;
      },
    }),
  ]);
  return {
    data: mapInterns(emps.data, appr.data),
    source: emps.source,
    capped: isRegisterCapped(emps.data.length),
    enrichmentFailed: appr.source === "error",
  } as LoaderResult<Row[]> & { enrichmentFailed: boolean; capped: boolean };
}

const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/**
 * GAP-HR-INTERNS-04 (DPDP): interns are frequently students and sometimes
 * minors. hr/layout.tsx admits plain "employee" into this tree and the
 * employees list route (the only source here) is deliberately open to every
 * employee as a directory, so without a page-level check any employee saw a
 * register whose whole point is to single out interns. HR staff see the
 * register; a manager sees it too (the backend already narrows a manager's
 * list to their direct reports). Policy default -- the one thing HR must
 * confirm is whether managers should keep access (see the PR's VERIFY list);
 * widening it later is a one-word change to this list. Mirrored in
 * hrTileAccess.ts so the hub stops offering the tile to roles denied here.
 */
const INTERNS_VIEW_ROLES = [...EMPLOYEE_ADMIN_ROLES, "manager"];

export default async function InternsPage() {
  const t = await getTranslations("interns");
  const roles = getSessionRoles();
  if (!roles.some((r: string) => INTERNS_VIEW_ROLES.includes(r))) {
    return <PermissionDenied module="the interns register" requiredRoles={INTERNS_VIEW_ROLES} backHref="/hr" backLabel="Back to HR" />;
  }
  const { data: items, source, enrichmentFailed, capped } = await getInterns();
  const errored = source === "error";
  const canAdd = roles.some((r: string) => EMPLOYEE_ADMIN_ROLES.includes(r));

  // GAP-HR-INTERNS-02: stat cards used to render 0 on a failed load (a
  // fabricated number beside the amber "couldn't load" badge); every other
  // sibling list page already shows "—" instead.
  const active = errored ? null : items.filter((i) => i.status === "active").length;
  const internsCount = errored ? null : items.filter((i) => i.type.toLowerCase().startsWith("intern")).length;
  const apprentices = errored ? null : items.filter((i) => i.type.toLowerCase().startsWith("apprentice")).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    { key: "type", label: t("colType") },
    { key: "status", label: t("colStatus"), cellType: "status" },
    { key: "stipend", label: t("colStipend") },
    { key: "period", label: t("colPeriod") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="Back to HR"
        actions={canAdd ? <a href="/hr/employees/new" className="btn primary">{t("addInternAction")}</a> : undefined}
      />
      <DataSourceBadge source={source} />
      {!errored && enrichmentFailed && (
        <p role="status" className="pill warn" style={{ margin: "0 0 12px" }}>{t("detailsUnavailable")}</p>
      )}
      {!errored && capped && (
        <p role="status" className="pill warn" style={{ margin: "0 0 12px" }}>{t("cappedNotice", { count: INTERNS_PAGE_LIMIT })}</p>
      )}
      <StatGrid>
        <StatCard icon="🎓" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={active ?? "—"} />
        <StatCard icon="📚" iconBg="var(--warnbg, #fffbe6)" label={t("statInternsLabel")} value={internsCount ?? "—"} />
        <StatCard icon="🔧" iconBg="var(--bg, #f5f5f5)" label={t("statApprenticesLabel")} value={apprentices ?? "—"} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "interns and apprentices" })} backHref="/hr" />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            // GAP-HR-INTERNS-06: rows now link to the existing employee
            // profile -- previously there was no way to open a record from
            // this register at all.
            rowHref={(r) => `/hr/employees/${r.id}`}
            sortable filterable filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🎓"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}

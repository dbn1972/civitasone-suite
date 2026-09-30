import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type ApiEmployee = {
  id: string;
  name: string;
  department: string;
  employeeType: string;
  status: string;
};

type Row = {
  id: string;
  name: string;
  department: string;
  type: string;
  status: string;
} & Record<string, unknown>;

const INTERN_TYPES = new Set(["intern", "apprentice", "internship", "apprenticeship"]);

/**
 * GAP-HR-INTERNS-01: same bug class as GAP-HR-CONTRACTUAL-01 -- the filter
 * read `e.employmentType ?? e.type`, but GET /v1/hrms/employees sends
 * `employeeType`; neither read field ever existed, so the register was
 * permanently empty. institution/mentor/periodFrom/periodTo are also not in
 * the employee-list payload at all (confirmed: employee/queries.ts's
 * listEmployees returns id/employeeNo/name/department/employeeType/status/
 * designation?/grade?/email? only) -- removed here rather than shown as
 * four permanent "—" columns, per the item's own fix guidance, until an
 * endpoint actually supplies them.
 */
function mapInterns(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => INTERN_TYPES.has((e.employeeType ?? "").toLowerCase()))
    .map((e) => ({
      id: e.id,
      name: e.name,
      department: e.department ?? "—",
      type: e.employeeType.replace(/^./, (c) => c.toUpperCase()),
      status: e.status,
    }));
}

async function getInterns(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.interns",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapInterns(arr as ApiEmployee[]) : null;
    },
  });
}

const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function InternsPage() {
  const t = await getTranslations("interns");
  const { data: items, source } = await getInterns();
  const errored = source === "error";
  const roles = getSessionRoles();
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

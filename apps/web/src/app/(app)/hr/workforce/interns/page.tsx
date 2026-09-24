import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";

/**
 * InternsPage — intern cohort list with institution, stipend, project, and end date.
 * MHRD apprenticeship guidelines and GoI internship scheme compliance.
 */

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  institution?: string;
  department?: string;
  periodFrom?: string;
  periodTo?: string;
  mentor?: string;
  projectAssigned?: string;
  project?: string;
  stipend?: string | number;
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  name: string;
  institution: string;
  department: string;
  projectAssigned: string;
  stipend: string;
  periodFrom: string;
  periodTo: string;
  mentor: string;
  type: string;
  status: string;
} & Record<string, unknown>;

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function mapInterns(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "intern" || t === "apprentice" || t === "internship" || t === "apprenticeship";
    })
    .map((e) => ({
      id: e.id,
      name: e.name ?? ([e.firstName, e.lastName].filter(Boolean).join(" ") || e.id),
      institution: e.institution ?? "—",
      department: e.department ?? "—",
      projectAssigned: e.projectAssigned ?? e.project ?? "—",
      stipend: e.stipend ? `₹${Number(e.stipend).toLocaleString("en-IN")}` : "—",
      periodFrom: formatDate(e.periodFrom),
      periodTo: formatDate(e.periodTo),
      mentor: e.mentor ?? "—",
      type: (e.employmentType ?? e.type ?? "Intern").replace(/^./, (c) => c.toUpperCase()),
      status: e.status,
    }));
}

async function getInterns(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.interns",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapInterns(arr as ApiEmployee[]) : null;
    },
  });
}

export default async function InternsPage() {
  const t = await getTranslations("workforceInterns");
  const { data: items, source } = await getInterns();
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const interns = items.filter((i) => ["intern", "internship"].includes(i.type.toLowerCase())).length;
  const apprentices = items.filter((i) => ["apprentice", "apprenticeship"].includes(i.type.toLowerCase())).length;

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: t("colName") },
    { key: "institution", label: t("colInstitution") },
    { key: "department", label: t("colDepartment") },
    { key: "projectAssigned", label: t("colProject") },
    { key: "stipend", label: t("colStipend") },
    { key: "periodFrom", label: t("colFrom") },
    { key: "periodTo", label: t("colEndDate") },
    { key: "mentor", label: t("colMentor") },
    { key: "type", label: t("colType") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎓" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")} value={errored ? null : active} />
        <StatCard icon="📚" iconBg="var(--warnbg, #fffbe6)" label={t("statInterns")} value={errored ? null : interns} />
        <StatCard icon="🔧" iconBg="var(--bg, #f5f5f5)" label={t("statApprentices")} value={errored ? null : apprentices} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "interns" })} backHref="/hr/workforce" />
          </div>
        ) : (
          <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
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

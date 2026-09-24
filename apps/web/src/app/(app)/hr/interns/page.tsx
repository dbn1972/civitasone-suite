import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  name: string;
  institution: string;
  department: string;
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
      periodFrom: formatDate(e.periodFrom),
      periodTo: formatDate(e.periodTo),
      mentor: e.mentor ?? "—",
      type: (e.employmentType ?? e.type ?? "Intern").replace(/^./, (c) => c.toUpperCase()),
      status: e.status,
    }));
}

async function getInterns(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=1000", [], {
    telemetryKey: "hr.interns",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapInterns(arr as ApiEmployee[]) : null;
    },
  });
  return res;
}

export default async function InternsPage() {
  const t = await getTranslations("interns");
  const { data: items, source } = await getInterns();

  const active = items.filter((i) => i.status === "active").length;
  const internsCount = items.filter((i) => i.type.toLowerCase() === "intern" || i.type.toLowerCase() === "internship").length;
  const apprentices = items.filter((i) => i.type.toLowerCase() === "apprentice" || i.type.toLowerCase() === "apprenticeship").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; sortable?: boolean }[] = [
    { key: "name", label: t("colName") },
    { key: "institution", label: t("colInstitution") },
    { key: "department", label: t("colDepartment") },
    { key: "periodFrom", label: t("colFrom"), sortable: false },
    { key: "periodTo", label: t("colTo"), sortable: false },
    { key: "mentor", label: t("colMentor") },
    { key: "type", label: t("colType") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎓" iconBg="#e6f0ff" label={t("statTotalLabel")} value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statActiveLabel")} value={active} />
        <StatCard icon="📚" iconBg="#fffbe6" label={t("statInternsLabel")} value={internsCount} />
        <StatCard icon="🔧" iconBg="#f5f5f5" label={t("statApprenticesLabel")} value={apprentices} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "interns and apprentices" })} />
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🎓"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}

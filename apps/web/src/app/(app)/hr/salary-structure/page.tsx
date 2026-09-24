import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

type ApiStructure = {
  id: string;
  name: string;
  grade?: string;
  components?: string;
  basicPayRange?: string;
  effectiveDate?: string;
  employeeCount?: number;
  status: string;
};

type Row = {
  id: string;
  name: string;
  grade: string;
  components: string;
  basicPay: string;
  effectiveDate: string;
  rawEffectiveDate: string;
  employees: string;
  status: string;
} & Record<string, unknown>;

function mapStructures(apiItems: ApiStructure[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade ?? "—",
    components: s.components ?? "—",
    basicPay: s.basicPayRange ?? "—",
    effectiveDate: formatIndianDate(s.effectiveDate),
    rawEffectiveDate: s.effectiveDate ?? "",
    employees: s.employeeCount != null ? String(s.employeeCount) : "—",
    status: s.status,
  }));
}

async function getStructures(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/structures", [], {
    telemetryKey: "hr.salary-structures",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiStructure[] })?.data;
      return Array.isArray(arr) ? mapStructures(arr as ApiStructure[]) : null;
    },
  });
}

export default async function SalaryStructurePage() {
  const t = await getTranslations("salaryStructure");
  const { data: items, source } = await getStructures();
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const totalEmployees = items.reduce((sum, i) => {
    const n = parseInt(i.employees);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const lastRevisionRaw = items
    .map((i) => i.rawEffectiveDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const lastRevision = lastRevisionRaw ? formatIndianDate(lastRevisionRaw) : "—";

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; sortable?: boolean }[] = [
    { key: "name", label: t("colStructureName") },
    { key: "grade", label: t("colGradeLevel") },
    { key: "components", label: t("colComponents") },
    { key: "basicPay", label: t("colBasicPayRange"), sortable: false },
    { key: "effectiveDate", label: t("colEffectiveDate"), sortable: false },
    { key: "employees", label: t("colEmployees") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label={t("statStructuresLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statActiveLabel")} value={errored ? null : active} />
        <StatCard icon="👥" iconBg="#fffbe6" label={t("statEmployeesCoveredLabel")} value={errored ? null : totalEmployees.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#f5f5f5" label={t("statLastRevisionLabel")} value={errored ? null : lastRevision} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "salary structures" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="💼"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}

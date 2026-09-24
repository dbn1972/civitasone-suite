import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  employee: string;
  department: string;
  grossIncome: string;
  deductions80C: string;
  otherDeductions: string;
  taxableIncome: string;
  taxPayable: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/income-tax", [], {
    telemetryKey: "payroll.income-tax",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function IncomeTaxPage() {
  const t = await getTranslations("incomeTax");
  const { data: items, source: source } = await getData();
  const errored = source === "error";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "rupees"; align?: "left" | "right" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "grossIncome", label: t("colGrossIncome"), cellType: "rupees", align: "right" },
    { key: "deductions80C", label: t("col80c"), cellType: "rupees", align: "right" },
    { key: "otherDeductions", label: t("colOtherDed"), cellType: "rupees", align: "right" },
    { key: "taxableIncome", label: t("colTaxableIncome"), cellType: "rupees", align: "right" },
    { key: "taxPayable", label: t("colTaxPayable"), cellType: "rupees", align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const fy = currentFinancialYear();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle", { fy })} back="/hr" />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statFinalized")} value={errored ? null : items.filter((i) => i.status === "finalized" || i.status === "completed").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : items.filter((i) => i.status === "pending" || i.status === "draft").length} />
        <StatCard icon="🏢" iconBg="var(--panel)" label={t("statDepartments")} value={errored ? null : new Set(items.map((i) => i.department)).size} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "income tax" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📊"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}

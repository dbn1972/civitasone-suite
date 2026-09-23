import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { formatRupees } from "@/lib/formatters";

// Wire shape from GET /v1/payroll/income-tax (tax/routes.ts): the money
// fields are `String(rupeeNumber)` -- e.g. grossIncome computed from
// slip.grossMinor/100, taxableIncome/taxPayable likewise rupee-scale -- not
// paise, so formatMoney()/cellType:"amount" (which assume minor units) would
// silently divide these by 100 again. Format with formatRupees() instead.
type ApiIncomeTaxRow = {
  id: string;
  employee: string;
  department: string;
  grossIncome: string;
  deductions80C: string;
  otherDeductions: string;
  taxableIncome: string;
  taxPayable: string;
  status: string;
};

type Row = ApiIncomeTaxRow & Record<string, unknown>;

function mapIncomeTaxRows(rows: ApiIncomeTaxRow[]): Row[] {
  return rows.map((r) => ({
    ...r,
    grossIncome: formatRupees(r.grossIncome),
    deductions80C: formatRupees(r.deductions80C),
    otherDeductions: formatRupees(r.otherDeductions),
    taxableIncome: formatRupees(r.taxableIncome),
    taxPayable: formatRupees(r.taxPayable),
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/income-tax", [], {
    telemetryKey: "payroll.income-tax",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiIncomeTaxRow[] })?.data;
      return Array.isArray(arr) ? mapIncomeTaxRows(arr as ApiIncomeTaxRow[]) : null;
    },
  });
  return r;
}

export default async function IncomeTaxPage() {
  const t = await getTranslations("incomeTax");
  const { data: items, source: source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "grossIncome", label: t("colGrossIncome"), align: "right" },
    { key: "deductions80C", label: t("col80c"), align: "right" },
    { key: "otherDeductions", label: t("colOtherDed"), align: "right" },
    { key: "taxableIncome", label: t("colTaxableIncome"), align: "right" },
    { key: "taxPayable", label: t("colTaxPayable"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const fy = currentFinancialYear();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle", { fy })} back="/hr" />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statFinalized")} value={items.filter((i) => i.status === "finalized" || i.status === "completed").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={items.filter((i) => i.status === "pending" || i.status === "draft").length} />
        <StatCard icon="🏢" iconBg="var(--panel)" label={t("statDepartments")} value={new Set(items.map((i) => i.department)).size} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📊"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}

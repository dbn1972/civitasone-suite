import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

type GpfRow = {
  id: string;
  employeeId: string;
  period: string;
  basicMinor: number;
  contribPct: number;
  empContribMinor: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<GpfRow[]>> {
  return fetchJson<unknown, GpfRow[]>("/api/v1/payroll/statutory/gpf", [], {
    telemetryKey: "payroll.statutory.gpf",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: GpfRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function GpfStatutoryPage() {
  const t = await getTranslations("gpf");
  const { data: rows, source } = await getData();

  const totalContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const uniqueEmployees = new Set(rows.map((r) => r.employeeId)).size;
  const uniquePeriods = new Set(rows.map((r) => r.period)).size;

  const columns: { key: keyof GpfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "basicMinor", label: t("colBasicPay"), align: "right", cellType: "amount" },
    { key: "contribPct", label: t("colRatePercent"), align: "right" },
    { key: "empContribMinor", label: t("colGpfContribution"), align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel="Back to Statutory"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg)" label={t("statGpfRecords")} value={rows.length} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalGpfSubscription")} value={formatMoney(totalContribMinor)} />
        <StatCard icon="👥" iconBg="var(--warnbg)" label={t("statUniqueEmployees")} value={uniqueEmployees} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statPeriodsCovered")} value={uniquePeriods} />
      </StatGrid>
      <Card title={t("historyCardTitle")}>
        <DataTable<GpfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

type EsiRow = {
  id: string;
  employeeId: string;
  period: string;
  grossMinor: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<EsiRow[]>> {
  return fetchJson<unknown, EsiRow[]>("/api/v1/payroll/statutory/esi", [], {
    telemetryKey: "payroll.statutory.esi",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: EsiRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function EsiStatutoryPage() {
  const t = await getTranslations("esi");
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalEsiMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof EsiRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "grossMinor", label: t("colGrossWages"), align: "right", cellType: "amount" },
    { key: "empContribMinor", label: t("colEmployeeEsi"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerEsi"), align: "right", cellType: "amount" },
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
        <StatCard icon="🩺" iconBg="var(--infobg)" label={t("statEsiRecords")} value={rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalEsiLiability")} value={formatMoney(totalEsiMinor)} />
      </StatGrid>
      <Card title={t("historyCardTitle")}>
        <DataTable<EsiRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🩺"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}

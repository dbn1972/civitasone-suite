import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type NpsRow = {
  id: string;
  employeeId: string;
  period: string;
  basicMinor: number;
  empContribPct: number;
  erContribPct: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<NpsRow[]>> {
  return fetchJson<unknown, NpsRow[]>("/api/v1/payroll/statutory/nps", [], {
    telemetryKey: "payroll.statutory.nps",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: NpsRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function NpsStatutoryPage() {
  const t = await getTranslations("nps");
  const { data: rows, source } = await getData();
  const errored = source === "error";

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalNpsMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof NpsRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "basicMinor", label: t("colBasicPay"), align: "right", cellType: "amount" },
    { key: "empContribPct", label: t("colEmployeeRatePercent"), align: "right" },
    { key: "erContribPct", label: t("colEmployerRatePercent"), align: "right" },
    { key: "empContribMinor", label: t("colEmployeeNps"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerNps"), align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label={t("statNpsRecords")} value={errored ? null : rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={errored ? null : formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={errored ? null : formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalNpsOutflow")} value={errored ? null : formatMoney(totalNpsMinor)} />
      </StatGrid>
      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "nps" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <DataTable<NpsRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
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

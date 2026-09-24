import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { EcrGeneratorForm } from "./EcrGeneratorForm";

type PfRow = {
  id: string;
  employeeId: string;
  period: string;
  basicMinor: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<PfRow[]>> {
  return fetchJson<unknown, PfRow[]>("/api/v1/payroll/statutory/pf", [], {
    telemetryKey: "payroll.statutory.pf",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PfRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function PfStatutoryPage() {
  const t = await getTranslations("pf");
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalPfMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof PfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "basicMinor", label: t("colBasic"), align: "right", cellType: "amount" },
    { key: "empContribMinor", label: t("colEmployeePf"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerPf"), align: "right", cellType: "amount" },
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
        <StatCard icon="🏦" iconBg="var(--infobg)" label={t("statPfRecords")} value={rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalPfOutflow")} value={formatMoney(totalPfMinor)} />
      </StatGrid>

      <EcrGeneratorForm />

      <Card title={t("historyCardTitle")}>
        <DataTable<PfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏦"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}

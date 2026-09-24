import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { LwfConfigForm } from "./LwfConfigForm";

type LwfRow = {
  state_code: string;
  employee_contrib_minor: number | string;
  employer_contrib_minor: number | string;
  frequency: string;
} & Record<string, unknown>;

type StateRulesResponse = { ptSlabs?: unknown[]; lwfConfig?: LwfRow[] };

async function getData(): Promise<LoaderResult<LwfRow[]>> {
  return fetchJson<StateRulesResponse, LwfRow[]>("/api/v1/payroll/statutory/state-rules", [], {
    telemetryKey: "payroll.statutory.lwf",
    mapResponse: (p) => (Array.isArray(p?.lwfConfig) ? p.lwfConfig! : null),
  });
}

export default async function LwfPage() {
  const t = await getTranslations("lwf");
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.employee_contrib_minor || 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.employer_contrib_minor || 0), 0);
  const uniqueFrequencies = new Set(rows.map((r) => r.frequency).filter(Boolean)).size;

  const columns: { key: keyof LwfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "state_code", label: t("colState") },
    { key: "employee_contrib_minor", label: t("colEmployeeContribution"), align: "right", cellType: "amount" },
    { key: "employer_contrib_minor", label: t("colEmployerContribution"), align: "right", cellType: "amount" },
    { key: "frequency", label: t("colFrequency") },
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
        <StatCard icon="🤝" iconBg="var(--infobg)" label={t("statStatesConfigured")} value={rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmpContribution")} value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={formatMoney(totalErContribMinor)} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statUniqueFrequencies")} value={uniqueFrequencies} />
      </StatGrid>

      <LwfConfigForm />

      <Card title={t("historyCardTitle")}>
        <DataTable<LwfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🤝"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}

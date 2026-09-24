import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CtcCalculatorForm } from "./CtcCalculatorForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type ConfigRow = {
  id: string;
  component_code: string;
  component_name: string;
  calc_type: string;
  value: string | number;
  is_employer_cost: boolean;
  is_active: boolean;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<ConfigRow[]>> {
  return fetchJson<unknown, ConfigRow[]>("/api/v1/payroll/ctc/config", [], {
    telemetryKey: "payroll.ctc.config",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ConfigRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

const CALC_TYPE_LABEL: Record<string, string> = {
  pct_of_basic: "% of Basic",
  pct_of_ctc: "% of CTC",
  fixed: "Fixed",
  formula: "Formula",
};

export default async function CtcConfigPage() {
  const t = await getTranslations("payrollCtc");
  const { data: config, source } = await getData();
  const errored = source === "error";

  const rows = config.map((c) => {
    const isPct = c.calc_type === "pct_of_basic" || c.calc_type === "pct_of_ctc";
    const numeric = Number(c.value);
    // Percentages: strip NUMERIC(10,4) trailing zeros ("40.0000" -> "40%").
    // Fixed/formula amounts are minor-unit rupees -> format as money (never a raw paise integer).
    const valueDisplay = isPct
      ? `${numeric}%`
      : Number.isFinite(numeric)
        ? formatMoney(c.value as number | string)
        : String(c.value);
    return {
      ...c,
      calcTypeLabel: CALC_TYPE_LABEL[c.calc_type] ?? c.calc_type,
      valueDisplay,
      employerCostLabel: c.is_employer_cost ? "Yes" : "No",
    };
  });

  type Row = (typeof rows)[number];

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right" }[] = [
    { key: "component_code", label: t("colCode") },
    { key: "component_name", label: t("colComponent") },
    { key: "calcTypeLabel", label: t("colCalculation") },
    { key: "valueDisplay", label: t("colValue"), align: "right" },
    { key: "employerCostLabel", label: t("colEmployerCost") },
  ];

  const employerComponents = config.filter((c) => c.is_employer_cost).length;
  const activeComponents = config.filter((c) => c.is_active).length;
  const pctComponents = config.filter((c) => c.calc_type.startsWith("pct_")).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="⚙️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : config.length} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label={t("statEmployerCost")} value={errored ? null : employerComponents} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={errored ? null : activeComponents} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statPctBased")} value={errored ? null : pctComponents} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "ctc" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚙️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>

      <CtcCalculatorForm />
    </main>
  );
}

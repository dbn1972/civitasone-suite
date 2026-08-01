import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CtcCalculatorForm } from "./CtcCalculatorForm";

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
  const { data: config, source } = await getData();

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
    { key: "component_code", label: "Code" },
    { key: "component_name", label: "Component" },
    { key: "calcTypeLabel", label: "Calculation" },
    { key: "valueDisplay", label: "Value", align: "right" },
    { key: "employerCostLabel", label: "Employer Cost" },
  ];

  const employerComponents = config.filter((c) => c.is_employer_cost).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="CTC Configuration"
        subtitle="Cost-to-Company component rules used to break a CTC figure into pay components."
        back="/hr/payroll"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="⚙️" iconBg="#e6f0ff" label="Configured Components" value={config.length} />
        <StatCard icon="🏛️" iconBg="#fffbe6" label="Employer-Cost Components" value={employerComponents} />
      </StatGrid>

      <Card title="CTC Component Configuration">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by code or component…"
          pageSize={15}
          emptyIcon="⚙️"
          emptyTitle="No CTC configuration found"
          emptyMessage="No active payroll_ctc_config rows are configured for this tenant."
        />
      </Card>

      <CtcCalculatorForm />
    </main>
  );
}

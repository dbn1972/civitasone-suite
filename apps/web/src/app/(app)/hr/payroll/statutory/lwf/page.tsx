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
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.employee_contrib_minor || 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.employer_contrib_minor || 0), 0);
  const uniqueFrequencies = new Set(rows.map((r) => r.frequency).filter(Boolean)).size;

  const columns: { key: keyof LwfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "state_code", label: "State" },
    { key: "employee_contrib_minor", label: "Employee Contribution", align: "right", cellType: "amount" },
    { key: "employer_contrib_minor", label: "Employer Contribution", align: "right", cellType: "amount" },
    { key: "frequency", label: "Frequency" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Labour Welfare Fund (LWF)"
        subtitle="State-wise LWF employee/employer contribution configuration."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="🤝" iconBg="var(--infobg)" label="States Configured" value={rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label="Total Emp Contribution" value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label="Total Employer Contribution" value={formatMoney(totalErContribMinor)} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label="Unique Frequencies" value={uniqueFrequencies} />
      </StatGrid>

      <LwfConfigForm />

      <Card title="LWF Configuration">
        <DataTable<LwfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by state…"
          pageSize={15}
          emptyIcon="🤝"
          emptyTitle="No LWF configuration"
          emptyMessage="Add a state's LWF contribution rates using the form above."
        />
      </Card>
    </main>
  );
}

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
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalPfMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof PfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: "Employee" },
    { key: "period", label: "Period" },
    { key: "basicMinor", label: "Basic", align: "right", cellType: "amount" },
    { key: "empContribMinor", label: "Employee PF (12%)", align: "right", cellType: "amount" },
    { key: "erContribMinor", label: "Employer PF (12%)", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Provident Fund (EPF)"
        subtitle="Employee/employer PF contributions and EPFO ECR file generation."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--infobg)" label="PF Records" value={rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label="Total Employee Contribution" value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label="Total Employer Contribution" value={formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label="Total PF Outflow" value={formatMoney(totalPfMinor)} />
      </StatGrid>

      <EcrGeneratorForm />

      <Card title="EPF Contribution Ledger">
        <DataTable<PfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or period…"
          pageSize={15}
          emptyIcon="🏦"
          emptyTitle="No PF records"
          emptyMessage="No EPF contributions have been recorded yet."
        />
      </Card>
    </main>
  );
}

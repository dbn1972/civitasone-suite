import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

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
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalNpsMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof NpsRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: "Employee" },
    { key: "period", label: "Period" },
    { key: "basicMinor", label: "Basic Pay", align: "right", cellType: "amount" },
    { key: "empContribPct", label: "Employee Rate (%)", align: "right" },
    { key: "erContribPct", label: "Employer Rate (%)", align: "right" },
    { key: "empContribMinor", label: "Employee NPS", align: "right", cellType: "amount" },
    { key: "erContribMinor", label: "Employer NPS", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="National Pension System (NPS)"
        subtitle="NPS contribution records for employees enrolled under the National Pension System (post-2004 recruits)."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="NPS Records" value={rows.length} />
        <StatCard icon="👤" iconBg="#e6f7f0" label="Total Employee Contribution (10%)" value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏛️" iconBg="#fffbe6" label="Total Employer Contribution (14%)" value={formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="#f5f5f5" label="Total NPS Outflow" value={formatMoney(totalNpsMinor)} />
      </StatGrid>
      <Card title="NPS Contribution Ledger">
        <DataTable<NpsRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or period…"
          pageSize={15}
          emptyIcon="📊"
          emptyTitle="No NPS records"
          emptyMessage="NPS contributions are deducted automatically during payroll runs for employees enrolled under the National Pension System (employees who joined government service after 1 January 2004)."
        />
      </Card>
    </main>
  );
}

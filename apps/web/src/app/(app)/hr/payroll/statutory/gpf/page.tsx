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
  const { data: rows, source } = await getData();

  const totalContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const uniqueEmployees = new Set(rows.map((r) => r.employeeId)).size;
  const uniquePeriods = new Set(rows.map((r) => r.period)).size;

  const columns: { key: keyof GpfRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: "Employee" },
    { key: "period", label: "Period" },
    { key: "basicMinor", label: "Basic Pay", align: "right", cellType: "amount" },
    { key: "contribPct", label: "Rate (%)", align: "right" },
    { key: "empContribMinor", label: "GPF Contribution", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="General Provident Fund (GPF)"
        subtitle="GPF subscription ledger for eligible employees under the old pension scheme."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg)" label="GPF Records" value={rows.length} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Total GPF Subscription" value={formatMoney(totalContribMinor)} />
        <StatCard icon="👥" iconBg="var(--warnbg)" label="Unique Employees" value={uniqueEmployees} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label="Periods Covered" value={uniquePeriods} />
      </StatGrid>
      <Card title="GPF Subscription Ledger">
        <DataTable<GpfRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or period…"
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle="No GPF records"
          emptyMessage="GPF subscriptions are deducted automatically during payroll runs for eligible employees under the old pension scheme (pre-2004 recruits)."
        />
      </Card>
    </main>
  );
}

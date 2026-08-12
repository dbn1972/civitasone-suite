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
  const { data: rows, source } = await getData();

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalEsiMinor = totalEmpContribMinor + totalErContribMinor;

  const columns: { key: keyof EsiRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeId", label: "Employee" },
    { key: "period", label: "Period" },
    { key: "grossMinor", label: "Gross Wages", align: "right", cellType: "amount" },
    { key: "empContribMinor", label: "Employee ESI", align: "right", cellType: "amount" },
    { key: "erContribMinor", label: "Employer ESI", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Employees' State Insurance (ESI)"
        subtitle="ESI contribution records for covered employees."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🩺" iconBg="#e6f0ff" label="ESI Records" value={rows.length} />
        <StatCard icon="👤" iconBg="#e6f7f0" label="Total Employee Contribution" value={formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="#fffbe6" label="Total Employer Contribution" value={formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="#f5f5f5" label="Total ESI Liability" value={formatMoney(totalEsiMinor)} />
      </StatGrid>
      <Card title="ESI Contribution Ledger">
        <DataTable<EsiRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or period…"
          pageSize={15}
          emptyIcon="🩺"
          emptyTitle="No ESI records"
          emptyMessage="No ESI contributions have been recorded yet."
        />
      </Card>
    </main>
  );
}

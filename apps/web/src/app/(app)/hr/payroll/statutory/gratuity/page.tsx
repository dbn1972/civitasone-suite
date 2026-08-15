import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { GratuityCalculator } from "./GratuityCalculator";

type GratuityRow = {
  id: string;
  employeeId: string;
  yearsOfService: number | string;
  gratuityMinor: number;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<GratuityRow[]>> {
  return fetchJson<unknown, GratuityRow[]>("/api/v1/payroll/statutory/gratuity", [], {
    telemetryKey: "payroll.statutory.gratuity",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: GratuityRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function GratuityPage() {
  const { data: rows, source } = await getData();
  const totalGratuityMinor = rows.reduce((s, r) => s + Number(r.gratuityMinor ?? 0), 0);
  const settledRecords = rows.filter((r) => r.status === "settled" || r.status === "paid").length;
  const avgYears =
    rows.length > 0
      ? (rows.reduce((s, r) => s + Number(r.yearsOfService || 0), 0) / rows.length).toFixed(1)
      : "0";

  const columns: {
    key: keyof GratuityRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount" | "status";
  }[] = [
    { key: "employeeId", label: "Employee" },
    { key: "yearsOfService", label: "Years of Service", align: "right" },
    { key: "gratuityMinor", label: "Gratuity Amount", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Gratuity"
        subtitle="Gratuity computation on separation (Payment of Gratuity Act, 1972)."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🎖️" iconBg="var(--infobg)" label="Gratuity Records" value={rows.length} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label="Total Gratuity Computed" value={formatMoney(totalGratuityMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled / Paid" value={settledRecords} />
        <StatCard icon="📅" iconBg="var(--panel)" label="Avg Years of Service" value={avgYears} />
      </StatGrid>

      <GratuityCalculator />

      <Card title="Gratuity Register">
        {rows.length === 0 ? (
          <EmptyState
            icon="🎖️"
            title="No gratuity records"
            message="Gratuity is computed automatically on employee separation. Records will appear here once an employee completes 5 years and separates."
          />
        ) : (
          <DataTable<GratuityRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by employee or status…"
            pageSize={15}
            emptyIcon="🎖️"
            emptyTitle="No gratuity records found"
            emptyMessage="No records match your filter criteria."
          />
        )}
      </Card>
    </main>
  );
}

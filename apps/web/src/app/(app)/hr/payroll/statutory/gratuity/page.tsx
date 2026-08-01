import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

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

  const columns: { key: keyof GratuityRow & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status" }[] = [
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
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🎖️" iconBg="#e6f0ff" label="Gratuity Records" value={rows.length} />
        <StatCard icon="💰" iconBg="#fffbe6" label="Total Gratuity Computed" value={formatMoney(totalGratuityMinor)} />
      </StatGrid>
      <Card title="Gratuity Register">
        <DataTable<GratuityRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or status…"
          pageSize={15}
          emptyIcon="🎖️"
          emptyTitle="No gratuity records"
          emptyMessage="Gratuity is computed automatically on employee separation."
        />
      </Card>
    </main>
  );
}

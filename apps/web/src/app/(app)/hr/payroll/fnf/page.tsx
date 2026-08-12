import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ComputeFnfForm } from "./ComputeFnfForm";

type SettlementRow = {
  id: string;
  employeeId: string;
  separationType: string;
  separationDate: string;
  netPayableMinor: string;
  status: string;
} & Record<string, unknown>;

async function getSettlements(): Promise<LoaderResult<SettlementRow[]>> {
  return fetchJson<unknown, SettlementRow[]>("/api/v1/payroll/fnf/settlements", [], {
    telemetryKey: "payroll.fnf.settlements",
    mapResponse: (p) => {
      const arr = (p as { data?: SettlementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function FnfPage() {
  const { data: settlements, source } = await getSettlements();

  const pending = settlements.filter((s) => s.status === "pending" || s.status === "computed").length;
  const settled = settlements.filter((s) => s.status === "settled" || s.status === "paid").length;
  const separationTypes = new Set(settlements.map((s) => s.separationType).filter(Boolean)).size;

  const columns: { key: keyof SettlementRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employeeId", label: "Employee ID" },
    { key: "separationType", label: "Separation Type" },
    { key: "separationDate", label: "Separation Date" },
    { key: "netPayableMinor", label: "Net Payable", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Full & Final Settlement"
        subtitle="Compute and track full-and-final (F&F) separation settlements."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🧮" iconBg="var(--infobg)" label="Total Settlements" value={settlements.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending / Computed" value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled" value={settled} />
        <StatCard icon="📊" iconBg="var(--panel)" label="Separation Types" value={separationTypes} />
      </StatGrid>

      <ComputeFnfForm />

      <Card title="F&F Settlements">
        <DataTable<SettlementRow>
          columns={columns}
          rows={settlements}
          sortable
          filterable
          filterPlaceholder="Filter by employee or type…"
          pageSize={15}
          emptyIcon="🧮"
          emptyTitle="No F&F settlements yet"
          emptyMessage="Compute a settlement using the form above; it is processed asynchronously and will appear here."
        />
      </Card>
    </main>
  );
}

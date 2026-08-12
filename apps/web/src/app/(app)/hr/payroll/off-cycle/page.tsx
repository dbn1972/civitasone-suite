import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateOffCycleForm } from "./CreateOffCycleForm";
import { OffCycleList, type OffCycleRow } from "./OffCycleList";

async function getData(): Promise<LoaderResult<OffCycleRow[]>> {
  return fetchJson<unknown, OffCycleRow[]>("/api/v1/payroll/off-cycle", [], {
    telemetryKey: "payroll.off-cycle",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: OffCycleRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OffCyclePage() {
  const { data: items, source } = await getData();

  const draftCount = items.filter((r) => r.status === "draft").length;
  const totalAmountMinor = items.reduce((sum, r) => sum + Number(r.total_amount_minor ?? 0), 0);
  const totalNetMinor = items.reduce((sum, r) => sum + Number(r.total_net_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Off-Cycle Payroll"
        subtitle="Bonus, incentive, and ad-hoc off-cycle payment runs."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🗂️" iconBg="#e6f0ff" label="Total Runs" value={items.length} />
        <StatCard icon="📝" iconBg="#fffbe6" label="Draft (Unprocessed)" value={draftCount} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Amount" value={formatMoney(totalAmountMinor)} />
        <StatCard icon="🧾" iconBg="#f0e6ff" label="Total Net (Processed)" value={formatMoney(totalNetMinor)} />
      </StatGrid>

      <CreateOffCycleForm />

      <Card title="Off-Cycle Runs">
        <OffCycleList rows={items} />
      </Card>
    </main>
  );
}

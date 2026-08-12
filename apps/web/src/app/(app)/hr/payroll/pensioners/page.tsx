import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { getPensioners } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import type { PensionerSummary } from "@civitasone/types";

type Row = PensionerSummary & { basicPensionDisplay: string };

export default async function PensionersPage() {
  const { data: pensioners, source } = await getPensioners();

  const total = pensioners.length;
  const active = pensioners.filter((p) => p.status === "active").length;
  const pensionPayableMinor = pensioners
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + p.basicPensionMinor, 0);

  const rows: Row[] = pensioners.map((p) => ({
    ...p,
    basicPensionDisplay: formatMoney(p.basicPensionMinor),
  }));

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "ppoNo", label: "PPO No" },
    { key: "fullName", label: "Name" },
    { key: "basicPensionDisplay", label: "Basic Pension", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
    { key: "ddoCode", label: "DDO Code" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pensioners"
        subtitle="Pension Payment Order management and disbursement tracking."
        back="/hr/payroll"
        actions={
          <Link href="/hr/payroll/pensioners/new" className="btn primary">+ Add Pensioner</Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👴" iconBg="#f5f5f5" label="Total Pensioners" value={total} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="💰" iconBg="#fffbe6" label="Pension Payable This Month" value={formatMoney(pensionPayableMinor)} />
      </StatGrid>
      <Card title="Pensioner Records">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by PPO number, name or DDO code…"
          pageSize={15}
        />
      </Card>
    </main>
  );
}

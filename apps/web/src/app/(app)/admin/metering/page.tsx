import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAMetering } from "@/app/_data/loaders";
import { MeteringTable } from "./MeteringTable";

export default async function MeteringPage() {
  const { data: meters, source } = await getSAMetering();
  const billed = meters.filter((m) => String(m.status).toLowerCase() === "billed").length;
  const overdue = meters.filter((m) => String(m.status).toLowerCase() === "overdue").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Usage Metering" subtitle="Per-tenant resource consumption and billing details." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Metered Tenants" value={meters.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Billed" value={billed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={meters.length - billed - overdue} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Overdue" value={overdue} />
      </StatGrid>
      <Card title="Usage & Billing">
        <MeteringTable meters={meters} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}

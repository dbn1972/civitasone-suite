import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAEditions } from "@/app/_data/loaders";
import { EditionsTable } from "./EditionsTable";

export default async function EditionsPage() {
  const { data: editions, source } = await getSAEditions();
  const active = editions.filter((e) => String(e.status).toLowerCase() === "active").length;
  const totalTenants = editions.reduce((s, e) => s + Number(e.tenants ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Edition Catalog" subtitle="Platform editions with module bundles, pricing and tenant allocation." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Total Editions" value={editions.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Total Tenants" value={totalTenants} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Deprecated" value={editions.length - active} />
      </StatGrid>
      <Card title="Editions">
        <EditionsTable editions={editions} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}

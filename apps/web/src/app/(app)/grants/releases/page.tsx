import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantReleases } from "../../../_data/loaders";
import { ReleasesTable } from "./ReleasesTable";

export default async function GrantReleasesPage() {
  const { data: releases, source } = await getGrantReleases();

  const processed = releases.filter((r) => r.status === "processed" || r.status === "credited").length;
  const pending = releases.filter((r) => r.status === "pending").length;
  const totalReleased = releases
    .filter((r) => r.status === "processed" || r.status === "credited")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Releases" subtitle="Fund releases to grantees with bank reference tracking." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Grant releases">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={releases.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Processed" value={processed} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          <StatCard icon="💰" iconBg="#dbeafe" label="Total Released" value={formatMoney(totalReleased)} />
        </StatGrid>
        <Card title="Releases">
          <ReleasesTable releases={releases} source={source} />
        </Card>
      </main>
    </>
  );
}

import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantReleases } from "../../../_data/loaders";
import { ReleasesTable } from "./ReleasesTable";
import { ArrowLeft } from "lucide-react";

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
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Releases" subtitle="Fund releases to grantees with bank reference tracking." />
      {/* UX-012: the data-source badge now lives inside ReleasesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <div aria-label="Grant releases">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={releases.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Processed" value={processed} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          <StatCard icon="💰" iconBg="#dbeafe" label="Total Released" value={formatMoney(totalReleased)} />
        </StatGrid>
        <Card title="Releases">
          <ReleasesTable releases={releases} source={source} />
        </Card>
      </div>
    </>
  );
}

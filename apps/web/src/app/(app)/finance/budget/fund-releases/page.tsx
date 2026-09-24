import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceFundReleases } from "@/app/_data/loaders";
import { FundReleasesTable } from "./FundReleasesTable";

export default async function FundReleasesPage() {
  const { data: releases, source } = await getFinanceFundReleases();

  const issued       = releases.filter((r) => r.status === "issued").length;
  const acknowledged = releases.filter((r) => r.status === "acknowledged").length;
  const pending      = releases.filter((r) => r.status === "pending").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fund Releases"
        subtitle="Allocation distributions issued to subordinate offices and departments."
        back="/finance"
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="var(--panel)"  label="Total Releases"  value={releases.length} />
        <StatCard icon="✅" iconBg="#ecfdf3"        label="Issued"          value={issued} />
        <StatCard icon="🤝" iconBg="#eff6ff"        label="Acknowledged"    value={acknowledged} />
        <StatCard icon="⏳" iconBg="#fffaeb"        label="Pending"         value={pending} up={false} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside FundReleasesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="Allocation Distributions (Fund Releases)">
        <FundReleasesTable releases={releases} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}

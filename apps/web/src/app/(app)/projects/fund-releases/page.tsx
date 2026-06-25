import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectFundReleases } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { FundReleasesTable, type FundReleaseRow } from "./FundReleasesTable";

export default async function FundReleasesPage() {
  const { data: releases, source } = await getProjectFundReleases();

  const totalReleased = releases.filter((r) => r.status === "released").reduce((s, r) => s + r.amount, 0);
  const totalSanctioned = releases.filter((r) => r.status === "sanctioned").reduce((s, r) => s + r.amount, 0);
  const totalUtilized = releases.filter((r) => r.status === "utilized").reduce((s, r) => s + r.amount, 0);

  const rows: FundReleaseRow[] = releases.map((r) => ({ ...r }));

  return (
    <>
      <PageHeader
        title="Fund Release Tracking"
        subtitle="Track releases to states/agencies, UC gating & PFMS flow."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={releases.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={formatMoney(totalReleased)} />
        <StatCard icon="📄" iconBg="#fffaeb" label="Sanctioned" value={formatMoney(totalSanctioned)} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Utilized" value={formatMoney(totalUtilized)} />
      </StatGrid>
      <Card title="Fund Releases">
        {rows.length === 0 ? (
          <EmptyState icon="💰" title="No fund releases" message="No funds have been released to projects yet." />
        ) : (
          <FundReleasesTable rows={rows} />
        )}
      </Card>
    </>
  );
}

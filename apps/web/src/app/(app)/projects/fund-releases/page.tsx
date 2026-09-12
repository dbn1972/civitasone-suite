import { getProjectFundReleases } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { FundReleasesTable, type FundReleaseRow } from "./FundReleasesTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function FundReleasesPage() {
  const result = await getProjectFundReleases();
  const { data: releases } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const totalReleased = errored ? null : releases.filter((r) => r.status === "released").reduce((s, r) => s + r.amount, 0);
  const totalSanctioned = errored ? null : releases.filter((r) => r.status === "sanctioned").reduce((s, r) => s + r.amount, 0);
  const totalUtilized = errored ? null : releases.filter((r) => r.status === "utilized").reduce((s, r) => s + r.amount, 0);

  const rows: FundReleaseRow[] = releases.map((r) => ({ ...r }));

  return (
    <>
      <PageHeader
        title="Fund Release Tracking"
        subtitle="Track releases to states/agencies, UC gating & PFMS flow."
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={errored ? "—" : releases.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={totalReleased === null ? "—" : formatMoney(totalReleased)} />
        <StatCard icon="📄" iconBg="#fffaeb" label="Sanctioned" value={totalSanctioned === null ? "—" : formatMoney(totalSanctioned)} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Utilized" value={totalUtilized === null ? "—" : formatMoney(totalUtilized)} />
      </StatGrid>
      <Card title="Fund Releases">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fund releases" })} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="💰" title="No fund releases" message="No funds have been released to projects yet." />
        ) : (
          <FundReleasesTable rows={rows} />
        )}
      </Card>
    </>
  );
}

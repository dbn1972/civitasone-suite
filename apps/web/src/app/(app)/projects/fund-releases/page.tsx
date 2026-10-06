import { getProjectFundReleases } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROJECT_FUND_DISBURSE_ROLES } from "@/lib/auth/roleGuard";
import { FundReleasesTable, type FundReleaseRow } from "./FundReleasesTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function FundReleasesPage() {
  const result = await getProjectFundReleases();
  const { data: releases } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const empty = resource.status === "empty";

  // GAP-PROJECTS-FUND-RELEASES-01: only offer the money-moving Disburse control
  // to roles the server's disburse route would accept (defence-in-depth; the
  // server stays the authority and 403s others).
  const canDisburse = hasAnyRole(getSessionRoles(), PROJECT_FUND_DISBURSE_ROLES);

  // GAP-PROJECTS-FUND-RELEASES-06: on an EMPTY list the money tiles show "—"
  // (no releases to total), not a fabricated ₹0.00 that reads like a real zero.
  const totalReleased = errored || empty ? null : releases.filter((r) => r.status === "released").reduce((s, r) => s + r.amount, 0);
  const totalSanctioned = errored || empty ? null : releases.filter((r) => r.status === "sanctioned").reduce((s, r) => s + r.amount, 0);
  const totalUtilized = errored || empty ? null : releases.filter((r) => r.status === "utilized").reduce((s, r) => s + r.amount, 0);

  const rows: FundReleaseRow[] = releases.map((r) => ({ ...r }));

  return (
    <>
      <PageHeader
        title="Fund Release Tracking"
        subtitle="Track releases to states/agencies, UC gating & PFMS flow."
        back="/projects"
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
            <RefreshErrorState error={toHumanError("load", { area: "fund releases" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="💰" title="No fund releases" message="No funds have been released to projects yet." />
        ) : (
          <FundReleasesTable rows={rows} canDisburse={canDisburse} />
        )}
      </Card>
    </>
  );
}

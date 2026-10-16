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
  //
  // GAP-PROJECTS-FUND-RELEASES-04: amounts are paise (bigint-safe integers).
  // Use BigInt summation so there are no floating-point rounding errors on
  // large sums (e.g. 100 Cr = 10_000_000_000 minor units). Convert back to
  // Number only at the formatMoney call, which accepts both.
  //
  // "Disbursed" tile = released + utilized: a utilised release has left the
  // "released" bucket, so "Total Disbursed" covers both states. This was the
  // W0-gap remainder: the old "Released" tile excluded utilised rows, making
  // the disbursed KPI misleadingly low for any project with utilised funds.
  function sumMinorBigInt(rows: typeof releases, ...statuses: string[]): bigint {
    const statusSet = new Set(statuses);
    return rows
      .filter((r) => statusSet.has(r.status))
      .reduce((s, r) => s + BigInt(Math.round(r.amount)), 0n);
  }

  const totalDisbursed = errored || empty ? null : sumMinorBigInt(releases, "released", "utilized");
  const totalSanctioned = errored || empty ? null : sumMinorBigInt(releases, "sanctioned");
  const totalUtilized = errored || empty ? null : sumMinorBigInt(releases, "utilized");

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
        <StatCard icon="✅" iconBg="#ecfdf3" label="Disbursed" value={totalDisbursed === null ? "—" : formatMoney(Number(totalDisbursed))} />
        <StatCard icon="📄" iconBg="#fffaeb" label="Sanctioned" value={totalSanctioned === null ? "—" : formatMoney(Number(totalSanctioned))} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Utilized" value={totalUtilized === null ? "—" : formatMoney(Number(totalUtilized))} />
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

import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceFundReleases } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { FundReleasesTable } from "./FundReleasesTable";

export default async function FundReleasesPage() {
  const result = await getFinanceFundReleases();
  const { data: releases } = result;
  // GAP-FINANCE-BUDGET-FUND-RELEASES-02: errored -> "—" cards + Retry state,
  // never four zeros above "No allocation distributions found."
  const errored = toResourceState(result).status === "error";

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
        <StatCard icon="📦" iconBg="var(--panel)"  label="Total Releases"  value={errored ? "—" : releases.length} />
        <StatCard icon="✅" iconBg="#ecfdf3"        label="Issued"          value={errored ? "—" : issued} />
        <StatCard icon="🤝" iconBg="#eff6ff"        label="Acknowledged"    value={errored ? "—" : acknowledged} />
        <StatCard icon="⏳" iconBg="#fffaeb"        label="Pending"         value={errored ? "—" : pending} up={false} />
      </StatGrid>

      {/* UX-012: the data-source badge lives inside FundReleasesTable. */}
      <Card title="Allocation Distributions (Fund Releases)">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fund releases" })} backHref="/finance" />
          </div>
        ) : (
          <FundReleasesTable releases={releases} source="api" />
        )}
      </Card>
    </div>
  );
}

import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES } from "../roles";
import { getGrants } from "../../../_data/loaders";
import { GrantsTable } from "./GrantsTable";

export default async function GrantsListPage() {
  const { data: grants, source } = await getGrants();

  // GAP-GRANTS-LIST-01 (FAILMASK): a failed fetch must not read as "no grants"
  // (Total 0 / Active 0 / ₹0.00). Show a retry state when the load errored AND
  // nothing came back. A legitimately empty tenant (source==='api', empty) is
  // NOT turned into an error state.
  if (source === "error" && grants.length === 0) {
    return (
      <>
        <PageHeader title="Grants" subtitle="All grants with lifecycle status." back="/grants" backLabel="Grants" />
        <RefreshErrorState
          error={toHumanError("load", { area: "grants" })}
          backHref="/grants"
          source={{ area: "grants" }}
        />
      </>
    );
  }

  // GAP-GRANTS-LIST-03: individual grantee names are PII; only privileged grants
  // roles see them in the clear.
  const canViewGranteeName = hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES);

  const active = grants.filter((g) => g.status === "active").length;
  const totalSanctioned = grants.reduce((s, g) => s + BigInt(Math.round(g.totalAmount)), 0n);
  const totalDisbursed = grants.reduce((s, g) => s + BigInt(Math.round(g.disbursedAmount)), 0n);

  // GAP-GRANTS-LIST-02: an "as of" time so the figures are not read as live when
  // they may be a cached/periodic snapshot (loader revalidates every 120s).
  const asOf = formatIndianDateTime(new Date());

  return (
    <>
      {/* GAP-GRANTS-LIST-04: use PageHeader's own back link instead of a
          hand-built <nav> + lucide icon + raw <a> (full reload). */}
      <PageHeader title="Grants" subtitle="All grants with lifecycle status." back="/grants" backLabel="Grants" />
      <div aria-label="Grants list">
        <p style={{ color: "var(--ink2)", marginBottom: 8, fontSize: 13 }}>As of {asOf}</p>
        <StatGrid>
          <StatCard icon="🎁" iconBg="#dcfce7" label="Total" value={grants.length} />
          <StatCard icon="✅" iconBg="#f0fdf4" label="Active" value={active} />
          <StatCard icon="💰" iconBg="#f1f5f9" label="Sanctioned" value={formatMoney(totalSanctioned)} />
          <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={formatMoney(totalDisbursed)} />
        </StatGrid>
        <Card title="Grants List">
          <GrantsTable grants={grants} source={source} canViewGranteeName={canViewGranteeName} />
        </Card>
      </div>
    </>
  );
}

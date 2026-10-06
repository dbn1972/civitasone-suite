import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_RELEASE_APPROVE_ROLES } from "../roles";
import { getGrantReleases } from "../../../_data/loaders";
import { ReleasesTable } from "./ReleasesTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantReleasesPage() {
  const { data: releases, source } = await getGrantReleases();

  // GAP-GRANTS-RELEASES-05 (FAILMASK): a failed fetch must not read as
  // Total 0 / Processed 0 / Pending 0 / ₹0.00. Show a retry state on error+empty.
  if (source === "error" && releases.length === 0) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="back">
          <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
        </nav>
        <PageHeader title="Grant Releases" subtitle="Fund releases to grantees with bank reference tracking." />
        <RefreshErrorState
          error={toHumanError("load", { area: "releases" })}
          backHref="/grants"
          source={{ area: "releases" }}
        />
      </>
    );
  }

  // GAP-GRANTS-RELEASES-01: only approver roles may approve a release.
  const canApprove = hasAnyRole(getSessionRoles(), GRANTS_RELEASE_APPROVE_ROLES);

  const processed = releases.filter((r) => r.status === "processed" || r.status === "credited").length;
  const pending = releases.filter((r) => r.status === "pending").length;
  // GAP-GRANTS-RELEASES-03 (money unit): amount is MINOR units (paise) on the
  // wire; sum as integer paise and render with formatMoney (consistent with the
  // list + detail pages). Summing paise avoids any float rounding on the total.
  const totalReleased = releases
    .filter((r) => r.status === "processed" || r.status === "credited")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Releases" subtitle="Fund releases to grantees with bank reference tracking." />
      <div aria-label="Grant releases">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={releases.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Processed" value={processed} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          {/* GAP-GRANTS-RELEASES-06: state the inclusion rule so the figure's
              meaning is explicit. */}
          <StatCard
            icon="💰"
            iconBg="#dbeafe"
            label="Total Released"
            value={formatMoney(totalReleased)}
            hint="Processed + credited releases only (excludes pending)."
          />
        </StatGrid>
        <Card title="Releases">
          <ReleasesTable releases={releases} source={source} canApprove={canApprove} />
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { LinkTiles } from "../../../_components/LinkTiles";
import { getProcurementDashboard } from "../../../_data/loaders";
import { formatIndianDateTime } from "@/lib/formatters";
// GAP-PROCUREMENT-DASHBOARD-04: the dashboard links the SAME shared module
// list as the /procurement hub (procurement/tiles.ts) so the two can never
// drift — previously the dashboard hard-coded its own 8-entry QUICK_LINKS,
// orphaning eight modules (incl. GeM, EMD & BG, Empanelment) from here.
import { procurementTiles } from "../tiles";

// GAP-PROCUREMENT-DASHBOARD-04: the Dashboard tile links back to this very
// page, so drop it from the on-dashboard quick-link grid; everything else in
// the shared hub list is shown so every module is reachable from here.
const QUICK_LINKS = procurementTiles.filter((tile) => tile.href !== "/procurement/dashboard");

export default async function ProcurementDashboardPage() {
  const { data: dashboard, source } = await getProcurementDashboard();
  // UX-013: `source` was already fetched but only wired to the badge below
  // (whose own message claims "showing nothing" on error) -- never to the
  // stat values, so a failed load rendered a literal "0", contradicting
  // that very message. Gate every stat on it, same convention as
  // projects/dashboard and estab/dashboard.
  const errored = source === "error";
  // GAP-PROCUREMENT-DASHBOARD-03: the copy claimed a "real-time" snapshot, but
  // the loader revalidates on a 60s window — this is a point-in-time snapshot,
  // not a live feed. Say so honestly and stamp when the figures were read
  // (same "Data as of" freshness convention as admin/api-monitoring), so a
  // stale cache is never mistaken for live. Not rendered when the load errored.
  const loadedAt = errored ? null : formatIndianDateTime(new Date());

  return (
    <>
      <PageHeader
        title="Procurement Management"
        subtitle="Snapshot of procurement activity and pending actions."
        help="procurement"
        actions={
          <>
            {loadedAt ? (
              <span className="muted" style={{ fontSize: "12px", alignSelf: "center" }} role="status">
                Data as of {loadedAt}
              </span>
            ) : null}
            <Link href="/procurement" className="btn ghost">View all modules</Link>
            <Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      {/* GAP-PROCUREMENT-DASHBOARD-02: the counters are a "snapshot of pending
          actions", so each must drill into the filtered list it counts (same
          deep-link convention as other module dashboards). Links are dropped
          when the load errored — a "—" tile has nothing to act on. */}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Pending Indents" value={errored ? "—" : dashboard.pendingIndents} href={errored ? undefined : "/procurement/indents?status=pending"} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Active POs" value={errored ? "—" : dashboard.activePOs} href={errored ? undefined : "/procurement/orders?status=active"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="GRNs (MTD)" value={errored ? "—" : dashboard.grnsThisMonth} href={errored ? undefined : "/procurement/grn"} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Contract Renewals Due" value={errored ? "—" : dashboard.contractRenewalsDue} href={errored ? undefined : "/procurement/contracts?status=renewal_due"} />
      </StatGrid>

      <Card title="Procurement modules">
        {/* GAP-PROCUREMENT-DASHBOARD-01 + 04: render the shared module list
            via LinkTiles (columns="four" -> .g-4: 4 cols desktop, 2 cols
            <=1080px, 1 col <=768px), so (a) the quick-link grid is responsive
            on tablet/phone — the old inline "repeat(4, 1fr)" beat the
            non-important tablet rule at 769-1080px, squeezing 8 tiles into 4
            columns — and (b) every hub module is reachable from the dashboard
            off the same single source of truth, never a drifting hard-coded
            subset. */}
        <div style={{ padding: "16px" }}>
          <LinkTiles tiles={QUICK_LINKS} columns="four" />
        </div>
      </Card>
    </>
  );
}

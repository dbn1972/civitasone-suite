import Link from "next/link";
import { PageHeader, StatCard, Card, EmptyState, RefreshErrorState } from "../../_components/ds";
import { getAuditItems } from "../../_data/loaders";
import { toResourceState } from "../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AuditBreadcrumb } from "./_components/AuditBreadcrumb";
import { AUDIT_SECTIONS } from "./_components/auditNav";
import { AuditLogTable } from "./AuditLogTable";

// Keep the Event Log sub-nav in sync with the shared section index
// (GAP-AUDIT-DASHBOARD-02) — show the cross-module jumps the Event Log always
// offered (CAG / Vigilance / Investigation) sourced from one list.
const SUBNAV = AUDIT_SECTIONS.filter((s) =>
  ["/audit/cag", "/audit/vigilance", "/audit/investigation"].includes(s.href),
);

export default async function AuditPage() {
  const result = await getAuditItems();
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const auditItems = result.data;

  // GAP-AUDIT-HOME-04: on a real fetch failure the KPIs must read "we don't
  // know" ("—"), not a fabricated all-zero dashboard that looks like a tenant
  // with no activity. StatCard already renders null as "—".
  const total = errored ? null : auditItems.length;
  const successes = errored ? null : auditItems.filter((i) => i.outcome === "success").length;
  const failures = errored ? null : auditItems.filter((i) => i.outcome === "failure").length;

  return (
    <div className="page-main wrap">
      {/* GAP-AUDIT-HOME-05: Event Log is the module home — its breadcrumb must
          not link "Audit" back to itself. */}
      <AuditBreadcrumb current="Event Log" isHome />
      <nav aria-label="Audit sub-modules" style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {SUBNAV.map((s) => (
          <Link key={s.href} href={s.href} className="btn ghost sm">{s.label}</Link>
        ))}
      </nav>
      <PageHeader
        title="Audit Events"
        subtitle="Tenant-scoped activity log with outcome and resource context."
        actions={<Link href="/audit/exports" className="btn ghost">Export</Link>}
      />
      {/* GAP-AUDIT-HOME-02: the old fourth "Policy Alerts" tile re-rendered the
          failures count under a different label — a fabricated signal with no
          backing data. Removed; the honest three KPIs the log can actually
          compute remain in a 3-up grid. */}
      {/* GAP2-AUDIT-HOME-10: these KPIs are computed over the loaded slice, and
          the service defaults the window to the last 7 days and caps the page
          at 50 rows (listQuerySchema.limit default) with no `total`. Presenting
          `auditItems.length` as an all-time "Total Events" silently pins a busy
          tenant at 50. Relabel honestly ("recent" + the window/cap in the hint)
          so the figure is not mistaken for an all-time total. */}
      <div className="grid g-3" style={{ marginBottom: 18 }}>
        <StatCard
          icon="📜"
          iconBg="#eef2ff"
          label="Recent events"
          value={total}
          hint="Events in the last 7 days, up to the most recent 50 shown below — not an all-time total."
        />
        <StatCard
          icon="✅"
          iconBg="#e6f7f0"
          label="Success (recent)"
          value={successes}
          hint="Successful outcomes among the recent events shown below."
        />
        <StatCard
          icon="🔐"
          iconBg="var(--warnbg)"
          label="Failures (recent)"
          value={failures}
          hint="Failed outcomes among the recent events shown below."
        />
      </div>
      {errored ? (
        <Card title="Audit event log">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "audit events" })} />
          </div>
        </Card>
      ) : auditItems.length === 0 ? (
        <Card title="Audit event log">
          <EmptyState
            icon="📜"
            title="No audit events yet"
            message="Tenant activity will appear here as users act across the suite."
          />
        </Card>
      ) : (
        <div className="card">
          <div className="card-h"><h3>Audit event log</h3></div>
          <div className="pad">
            <AuditLogTable rows={auditItems} />
          </div>
        </div>
      )}
    </div>
  );
}

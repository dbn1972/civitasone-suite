import Link from "next/link";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../_components/ds";
import { getAuditItems } from "../../_data/loaders";
import { AuditLogTable } from "./AuditLogTable";

export default async function AuditPage() {
  const { data: auditItems, source } = await getAuditItems();

  const total = auditItems.length;
  const successes = auditItems.filter((i) => i.outcome === "success").length;
  const failures = auditItems.filter((i) => i.outcome === "failure").length;

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Event Log</span>
      </nav>
      <PageHeader
        title="Audit Events"
        subtitle="Tenant-scoped activity log with outcome and resource context."
        actions={<Link href="/audit/exports" className="btn ghost">Export</Link>}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#eef2ff" label="Total Events" value={total} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Success" value={successes} />
        <StatCard icon="🔐" iconBg="#fffaeb" label="Failures" value={failures} />
        <StatCard icon="🚨" iconBg="#fef3f2" label="Policy Alerts" value={failures > 0 ? failures : 0} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h"><h3>Audit event log</h3></div>
        <div className="pad">
          <AuditLogTable rows={auditItems} />
        </div>
      </div>
    </main>
  );
}

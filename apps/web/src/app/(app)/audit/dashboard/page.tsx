import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAuditDashboard } from "../../../_data/loaders";

const QUICK_LINKS = [
  { label: "Observations", href: "/audit/observations" },
  { label: "Risk Register", href: "/audit/risk-register" },
  { label: "Audit Plan", href: "/audit/plan" },
  { label: "Compliance Tracking", href: "/audit/compliance" },
  { label: "Event Log", href: "/audit" },
  { label: "Export Jobs", href: "/audit/exports" },
];

export default async function AuditDashboardPage() {
  const { data, source } = await getAuditDashboard();

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <span aria-current="page">Audit Dashboard</span>
      </nav>
      <PageHeader
        title="Audit & Compliance Dashboard"
        subtitle="Overview of audit observations, risk register, and compliance status."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="var(--badbg)" label="Open Observations" value={data.openObservations} />
        <StatCard icon="⚠️" iconBg="var(--warnbg)" label="Risk Register Items" value={data.riskRegisterItems} />
        <StatCard icon="📑" iconBg="var(--infobg)" label="CAG Paras" value={data.cagParas} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Compliance" value={`${data.compliancePct.toFixed(1)}%`} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h"><h3>Quick links</h3></div>
        <div className="pad">
          <nav aria-label="Audit sections" className="grid g-4">
            {QUICK_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="card" style={{ padding: 16, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}

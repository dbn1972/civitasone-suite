import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementDashboard } from "../../../_data/loaders";

const QUICK_LINKS = [
  { label: "Purchase Indents", href: "/procurement/indents", icon: "📋" },
  { label: "Vendors", href: "/procurement/vendors", icon: "🏢" },
  { label: "RFQ", href: "/procurement/rfq", icon: "📝" },
  { label: "Purchase Orders", href: "/procurement/orders", icon: "📦" },
  { label: "Goods Receipt", href: "/procurement/grn", icon: "✅" },
  { label: "Contracts", href: "/procurement/contracts", icon: "📄" },
  { label: "Tenders", href: "/procurement/tenders", icon: "🏛️" },
  { label: "Approvals", href: "/procurement/approvals", icon: "🖊️" },
];

export default async function ProcurementDashboardPage() {
  const { data: dashboard, source } = await getProcurementDashboard();

  return (
    <>
      <PageHeader
        title="Procurement Management"
        subtitle="Real-time snapshot of procurement activity and pending actions."
        actions={
          <>
            <Link href="/procurement/indents" className="btn ghost">View all</Link>
            <Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Pending Indents" value={dashboard.pendingIndents} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Active POs" value={dashboard.activePOs} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="GRNs (MTD)" value={dashboard.grnsThisMonth} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Contract Renewals Due" value={dashboard.contractRenewalsDue} />
      </StatGrid>

      <Card title="Procurement modules">
        <div className="grid g-4" style={{ padding: "16px", gap: "12px", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="stat"
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              <div className="top">
                <div className="ic" style={{ background: "#eef2ff" }}>{link.icon}</div>
              </div>
              <div className="lab">{link.label}</div>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}

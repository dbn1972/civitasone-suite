import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";

type DashboardData = {
  totalWorks: number;
  activeWorks: number;
  closedWorks: number;
  byStatus: Record<string, number>;
};

function isDashboard(v: unknown): v is { data: DashboardData } {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as { data?: unknown }).data;
  return typeof d === "object" && d !== null && typeof (d as DashboardData).totalWorks === "number";
}

async function getWorksDashboard(): Promise<LoaderResult<DashboardData>> {
  return fetchJson<unknown, DashboardData>(
    "/api/v1/works/dashboard",
    { totalWorks: 0, activeWorks: 0, closedWorks: 0, byStatus: {} },
    {
      telemetryKey: "works.dashboard",
      mapResponse: (payload) => (isDashboard(payload) ? payload.data : null),
    },
  );
}

const MODULES: Array<{ href: string; label: string; icon: string; desc: string }> = [
  { href: "/works/proposals",   label: "Work Proposals",   icon: "📋", desc: "Register and track proposals" },
  { href: "/works/tenders",     label: "Tender Pipeline",  icon: "📢", desc: "Publish and manage tenders" },
  { href: "/works/contractors", label: "Contractors",      icon: "🏢", desc: "Registered firms & ratings" },
  { href: "/works/execution",   label: "Execution",        icon: "🏗️", desc: "Progress, issues, photos" },
  { href: "/works/billing",     label: "Bills & MB",       icon: "💰", desc: "MBs, bills and disbursement" },
  { href: "/works/procurement", label: "Procurement",      icon: "📦", desc: "Purchase orders" },
  { href: "/works/masters",     label: "Masters Registry", icon: "📚", desc: "Lookup values & categories" },
  { href: "/works/reports",     label: "Reports",          icon: "📊", desc: "Analytics and work register" },
];

const WORKS_ADMIN_ROLES = ["works_admin", "dao", "do", "super_admin", "div_officer"];

export default async function WorksHub() {
  const { data: dash, source } = await getWorksDashboard();
  const roles = getSessionRoles();
  const canAdmin = roles.some((r) => WORKS_ADMIN_ROLES.includes(r));

  const draftCount   = dash.byStatus["draft"]     ?? 0;
  const pendingCount = dash.byStatus["submitted"]  ?? dash.byStatus["pending"] ?? 0;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Works & Billing"
        subtitle="Engineering works lifecycle — proposals to bills."
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🏗️" iconBg="var(--infobg, #eff6ff)"  label="Total Works"  value={dash.totalWorks} />
        <StatCard icon="▶️"  iconBg="var(--goodbg, #ecfdf3)"  label="Active"       value={dash.activeWorks} />
        <StatCard icon="✅"  iconBg="var(--panel, #f1f5f9)"   label="Completed"    value={dash.closedWorks} />
        <StatCard icon="📝"  iconBg="var(--warnbg, #fef3c7)"  label="Draft"        value={draftCount} />
        <StatCard icon="⏳"  iconBg="#fdf2f8"                 label="Pending"      value={pendingCount} />
      </StatGrid>

      {canAdmin && (
        <Card title="Quick Actions" padding>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href="/works/proposals/new"          className="btn ghost" style={{ fontSize: 13 }}>📋 New Proposal</Link>
            <Link href="/works/tenders/new"            className="btn ghost" style={{ fontSize: 13 }}>📢 Create Tender</Link>
            <Link href="/works/contractors/new"        className="btn ghost" style={{ fontSize: 13 }}>🏢 Register Contractor</Link>
            <Link href="/works/billing/account-compile" className="btn ghost" style={{ fontSize: 13 }}>💼 Account Compile</Link>
          </div>
        </Card>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 8,
        }}
      >
        {MODULES.map(({ href, icon, label, desc }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 20,
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--surface, #fff)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{label}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{desc}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

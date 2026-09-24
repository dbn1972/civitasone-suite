import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSADashboard, getSAOperationsSnapshot } from "@/app/_data/loaders";
import { SADashboardTable } from "./SADashboardTable";

export default async function SaDashboardPage() {
  const [{ data: dashboard, source }, { data: operations, source: opsSource }] = await Promise.all([
    getSADashboard(),
    getSAOperationsSnapshot(),
  ]);
  const tenants = Number(dashboard.activeTenants ?? 0);
  // totalUsers is an honest `null` from the backend when no cross-tenant user
  // count exists to report (see services/admin-service/.../health/sa-dashboard.ts's
  // doc comment: identity-service's user store is tenant-scoped only, so
  // there is no real platform-wide total to source) — show "—", never a
  // fabricated 0, same convention as this file's own uptime/services handling
  // below and apps/web/.../tenant-admin/mfa/page.tsx's unavailable-count case.
  const users = dashboard.totalUsers == null ? "—" : Number(dashboard.totalUsers);
  // No backend has ever populated `dashboard.uptime` (GET /api/v1/admin/sa-dashboard
  // has no matching route at all today) and no real "% uptime over time" telemetry
  // exists anywhere in the platform yet — admin-service's own operations snapshot
  // lists "Uptime Kuma" under externalMonitorRecommendation as a tool still to be
  // ADDED. So there is nothing honest to compute here yet; show "—" instead of a
  // fabricated number until that field (or real uptime infra) is real.
  const uptime = String(dashboard.uptime ?? "—");
  const uptimeAvailable = dashboard.uptime != null;

  // "Services" reflects the real, live PM2 fleet snapshot (GET /v1/admin/operations,
  // already used by the ops tooling) — services actually online vs. declared —
  // instead of a hardcoded "33". "—" when the snapshot itself failed to load, or
  // when PM2 wasn't reachable (pm2Available: false): in that case "online" would
  // mean "unknown", not "confirmed zero".
  const opsSummary = (operations.summary ?? {}) as Record<string, unknown>;
  const opsUnavailable = opsSource === "error" || operations.pm2Available === false;
  const servicesLabel = opsUnavailable
    ? "—"
    : `${Number(opsSummary.onlineProcesses ?? 0)}/${Number(opsSummary.totalProcesses ?? 0)}`;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Super Admin Dashboard"
        subtitle="Platform-wide health, revenue and growth overview."
        back="/admin"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Active Tenants" value={tenants} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Users" value={users} />
        <StatCard icon="💚" iconBg={uptimeAvailable ? "#fffaeb" : "#f2f4f7"} label="Platform Uptime" value={uptime} />
        <StatCard icon="📊" iconBg={opsUnavailable ? "#f2f4f7" : "#eff6ff"} label="Services" value={servicesLabel} />
      </StatGrid>
      <Card title="Platform KPIs">
        <SADashboardTable dashboard={dashboard} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}

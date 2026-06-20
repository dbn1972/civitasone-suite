import type { NavTile } from "@civitasone/types";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";
import { StatCardGrid } from "../../_components/StatCardGrid";
import { getTenantAdminDashboard } from "../../_data/loaders";

const quickActions: NavTile[] = [
  { title: "Users", href: "/tenant-admin/users" },
  { title: "Roles", href: "/tenant-admin/roles" },
  { title: "Settings & Modules", href: "/tenant-admin/settings" },
  { title: "Audit Log", href: "/tenant-admin/audit" },
  { title: "Sessions", href: "/tenant-admin/sessions" },
  { title: "Subscription", href: "/tenant-admin/subscription" },
  { title: "API Keys", href: "/tenant-admin/api-keys" },
  { title: "Break-Glass Log", href: "/tenant-admin/breakglass" },
  { title: "Notification Prefs", href: "/tenant-admin/notifications" },
  { title: "Customize theme", href: "/themes" },
  { title: "Manage plugins", href: "/plugins" },
];

function healthStatusClass(status: string): string {
  if (status === "ok") return "text-emerald-700";
  if (status === "degraded") return "text-amber-700";
  return "text-red-700";
}

function readinessScoreClass(score: number): string {
  if (score >= 95) return "text-emerald-700";
  if (score >= 80) return "text-amber-700";
  return "text-red-700";
}

export default async function Page() {
  const { data: dashboard, source } = await getTenantAdminDashboard();
  const { kpis, health, readiness, modules } = dashboard;

  return (
    <PageShell
      title="Tenant Administration"
      description="Manage users, policy, health, plugins, and branding from one workspace."
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      <section className="space-y-6">
        <section aria-labelledby="kpi-heading">
          <h2 id="kpi-heading" className="sr-only">
            Key performance indicators
          </h2>
          <StatCardGrid items={kpis} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Service Health</h2>
              {health.services.length > 0 ? (
                <span className={`text-sm font-medium capitalize ${healthStatusClass(health.status)}`}>
                  {health.status}
                </span>
              ) : null}
            </div>
            {health.services.length > 0 ? (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm text-slate-700">
                {health.services.map((service) => (
                  <li key={service.service} className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs sm:text-sm">{service.service}</span>
                    <span className={healthStatusClass(service.status)}>{service.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No service health data available.</p>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Enterprise Readiness Score</h2>
            {readiness ? (
              <>
                <p className={`mt-3 text-4xl font-bold ${readinessScoreClass(readiness.overall)}`}>
                  {readiness.overall} / 100
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {readiness.productionReady
                    ? "All production gates are green."
                    : "Security, reliability, and backup posture refreshed on demand."}
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Readiness score unavailable.</p>
            )}
          </article>
        </section>

        {modules.length > 0 ? (
          <section aria-labelledby="modules-heading">
            <h2 id="modules-heading" className="text-lg font-semibold text-slate-900">
              Tenant Modules
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {modules.map((module) => (
                <li
                  key={module.name}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
                >
                  {module.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="quick-heading">
          <h2 id="quick-heading" className="text-lg font-semibold text-slate-900">
            Quick Actions
          </h2>
          <div className="mt-3">
            <LinkTiles tiles={quickActions} />
          </div>
        </section>
      </section>
    </PageShell>
  );
}

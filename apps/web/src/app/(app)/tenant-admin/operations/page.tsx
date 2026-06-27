import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, EmptyState } from "../../../_components/ds";
import { getAdminOperationsDashboard } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ProcessesTable, SchedulersTable, RecentErrorsTable } from "./OperationsTables";

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function operationsScore(ops: Awaited<ReturnType<typeof getAdminOperationsDashboard>>["data"]): number {
  const checks = [
    ops.pm2Available,
    ops.summary.totalProcesses > 0 && ops.summary.onlineProcesses === ops.summary.totalProcesses,
    ops.summary.workersTotal > 0 && ops.summary.workersOnline === ops.summary.workersTotal,
    ops.queue.healthy,
    ops.summary.outboxPending === 0,
    ops.summary.failedJobs === 0,
    ops.recentErrors.length === 0,
    ops.schedulers.length > 0 && ops.schedulers.every((job) => job.status === "online"),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 10);
}

function incidentSummary(ops: Awaited<ReturnType<typeof getAdminOperationsDashboard>>["data"]): { level: "bad" | "warn"; title: string; detail: string } | null {
  const blockers: string[] = [];
  if (!ops.pm2Available) blockers.push("PM2 is unavailable");
  if (!ops.queue.healthy) blockers.push("queue health check is failing");
  if (ops.summary.workersTotal > 0 && ops.summary.workersOnline < ops.summary.workersTotal) blockers.push("one or more workers are not online");
  if (ops.summary.failedJobs > 0) blockers.push(`${ops.summary.failedJobs} PM2 process(es) are not online`);
  if (ops.summary.outboxPending > 0) blockers.push(`${ops.summary.outboxPending} admin outbox message(s) are pending`);
  if (ops.recentErrors.length > 0) blockers.push(`${ops.recentErrors.length} recent redacted log error(s) were found`);
  if (blockers.length === 0) return null;
  const level = !ops.pm2Available || !ops.queue.healthy || ops.summary.failedJobs > 0 ? "bad" : "warn";
  return {
    level,
    title: level === "bad" ? "Operations attention required" : "Operations warning",
    detail: `${blockers.join("; ")}. Check PM2, queue, outbox relay, and external alerts before marking the platform healthy.`,
  };
}

export default async function AdminOperationsPage() {
  requireAnyRole(["platform_admin", "super_admin"], "/tenant-admin");
  const { data: ops, source } = await getAdminOperationsDashboard();
  const workers = ops.processes.filter((p) => p.kind === "worker");
  const services = ops.processes.filter((p) => p.kind === "service" || p.kind === "infrastructure");
  const score = operationsScore(ops);
  const incident = incidentSummary(ops);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Operations" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Admin Operations Dashboard"
        subtitle="Monitor PM2 services, workers, queues, schedulers, cron activity, outbox backlog, and recent operational errors."
        actions={<span className={`pill ${ops.pm2Available ? "good" : "warn"}`}>PM2 {ops.pm2Available ? "connected" : "unavailable"}</span>}
      />
      {incident && (
        <div className={`alert ${incident.level}`} role="status" aria-live="polite">
          <strong>{incident.title}</strong>
          <p>{incident.detail}</p>
        </div>
      )}
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏆" iconBg="#f1f5f9" label="Ops Score" value={`${score}/10`} />
        <StatCard icon="💚" iconBg="#ecfdf3" label="PM2 Online" value={`${ops.summary.onlineProcesses}/${ops.summary.totalProcesses}`} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="Workers Online" value={`${ops.summary.workersOnline}/${ops.summary.workersTotal}`} />
        <StatCard icon="🚨" iconBg="#fef3f2" label="Processes Not Online" value={ops.summary.failedJobs} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>Queue health</h3>
            <span className={`pill ${ops.queue.healthy ? "good" : "bad"}`}>{ops.queue.healthy ? "healthy" : "unhealthy"}</span>
          </div>
          <div className="pad">
            <p style={{ marginTop: 0 }}>{ops.queue.detail}</p>
            <div className="prefrow"><span>Admin outbox pending count</span><span className="mono">{ops.outbox.pending}</span></div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>External alerting</h3>
            <span className="pill info">recommended</span>
          </div>
          <div className="pad">
            {ops.externalMonitorRecommendation.map((item) => (
              <div key={item.tool} className="prefrow">
                <strong>{item.tool}</strong>
                <span>{item.purpose}</span>
              </div>
            ))}
            <div className="prefrow">
              <strong>Required alerts</strong>
              <span>web/gateway down, any worker down, queue unhealthy, outbox pending growing, recent errors detected</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>PM2 service health</h3>
          <span className="pill info">{services.length} processes</span>
        </div>
        <ProcessesTable processes={services} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Worker status</h3>
          <span className="pill info">{workers.length} workers</span>
        </div>
        <ProcessesTable processes={workers} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Scheduler status and last cron run</h3>
          <span className="pill info">{ops.schedulers.length} schedulers</span>
        </div>
        <SchedulersTable schedulers={ops.schedulers} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Logs and errors</h3>
          <span className={`pill ${ops.recentErrors.length > 0 ? "bad" : "good"}`}>{ops.recentErrors.length} recent</span>
        </div>
        {ops.recentErrors.length > 0 ? (
          <RecentErrorsTable errors={ops.recentErrors.slice(0, 25)} />
        ) : (
          <EmptyState icon="✅" title="No recent errors" message="Recent PM2 log errors will appear here when detected." />
        )}
      </div>

      <p className="muted" style={{ marginTop: 18 }}>Last checked: {formatDate(ops.checkedAt)}. Log excerpts are redacted server-side before display.</p>
    </main>
  );
}

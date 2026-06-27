import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, DataTable, EmptyState } from "../../../_components/ds";
import { getAdminOperationsDashboard, type AdminOperationProcess, type AdminOperationScheduler } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { requireAnyRole } from "@/lib/auth/roleGuard";

function statusClass(status: string): string {
  if (status === "online" || status === "ok") return "good";
  if (status === "unknown" || status === "degraded") return "warn";
  return "bad";
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

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

type ProcessRow = AdminOperationProcess & Record<string, unknown>;
type SchedulerRow = AdminOperationScheduler & Record<string, unknown>;

function ProcessesTable({ processes }: { processes: AdminOperationProcess[] }) {
  if (processes.length === 0) {
    return <EmptyState icon="🖥️" title="No PM2 data" message="Install PM2 on the app host and expose it to admin-service to populate process health." />;
  }
  const rows = processes as ProcessRow[];
  return (
    <DataTable<ProcessRow>
      columns={[
        { key: "name", label: "Process", render: (p) => <span className="mono">{p.name as string}</span> },
        { key: "kind", label: "Type" },
        { key: "status", label: "Status", render: (p) => <span className={`pill ${statusClass(p.status as string)}`}>{p.status as string}</span> },
        { key: "restarts", label: "Restarts" },
        { key: "cpuPct", label: "CPU", render: (p) => <>{p.cpuPct}%</> },
        { key: "memoryMb", label: "Memory", render: (p) => <>{p.memoryMb} MB</> },
        { key: "uptimeSeconds", label: "Uptime", render: (p) => formatDuration(p.uptimeSeconds as number | null) },
      ]}
      rows={rows}
    />
  );
}

function SchedulersTable({ schedulers }: { schedulers: AdminOperationScheduler[] }) {
  if (schedulers.length === 0) {
    return <EmptyState icon="⏱️" title="No scheduler data" message="Scheduler ownership will appear once operations data is available." />;
  }
  const rows = schedulers as SchedulerRow[];
  return (
    <DataTable<SchedulerRow>
      columns={[
        { key: "name", label: "Scheduler" },
        { key: "ownerProcess", label: "Owner", render: (j) => <span className="mono">{j.ownerProcess as string}</span> },
        { key: "schedule", label: "Schedule" },
        { key: "status", label: "Status", render: (j) => <span className={`pill ${statusClass(j.status as string)}`}>{j.status as string}</span> },
        { key: "lastObservedAt", label: "Last cron run", render: (j) => formatDate(j.lastObservedAt as string | undefined) },
      ]}
      rows={rows}
    />
  );
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
          <DataTable<{ source: string; line: string } & Record<string, unknown>>
            columns={[
              { key: "source", label: "Source", render: (e) => <span className="mono">{e.source as string}</span> },
              { key: "line", label: "Redacted error", render: (e) => <span className="mono">{e.line as string}</span> },
            ]}
            rows={(ops.recentErrors.slice(0, 25) as ({ source: string; line: string } & Record<string, unknown>)[])}
          />
        ) : (
          <EmptyState icon="✅" title="No recent errors" message="Recent PM2 log errors will appear here when detected." />
        )}
      </div>

      <p className="muted" style={{ marginTop: 18 }}>Last checked: {formatDate(ops.checkedAt)}. Log excerpts are redacted server-side before display.</p>
    </main>
  );
}

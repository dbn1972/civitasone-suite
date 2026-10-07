import { PageHeader, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getAdminOperationsDashboard } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { ProcessesTable, SchedulersTable, RecentErrorsTable } from "./OperationsTables";

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  // GAP-TENANT-ADMIN-OPERATIONS-05: pin to IST so SSR and client agree and the
  // operator reads one timezone regardless of their browser locale.
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : `${date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST`;
}

// GAP-TENANT-ADMIN-OPERATIONS-02: the health score is 8 equally-weighted
// checks. Rather than a bare "n/10" with no explanation, we return WHICH checks
// are passing/failing and whether PM2 is reporting at all. When PM2 is
// unavailable we cannot judge the process/worker checks, so they are "unknown"
// (not silently failed), and the headline becomes "n of M checks passing" over
// only the checks we could actually evaluate.
type OpsCheck = { label: string; ok: boolean | "unknown" };
function operationsChecks(ops: Awaited<ReturnType<typeof getAdminOperationsDashboard>>["data"]): OpsCheck[] {
  const pm2 = ops.pm2Available;
  const pm2Dependent = (v: boolean): boolean | "unknown" => (pm2 ? v : "unknown");
  return [
    { label: "PM2 reporting", ok: pm2 },
    { label: "All PM2 processes online", ok: pm2Dependent(ops.summary.totalProcesses > 0 && ops.summary.onlineProcesses === ops.summary.totalProcesses) },
    { label: "All workers online", ok: pm2Dependent(ops.summary.workersTotal > 0 && ops.summary.workersOnline === ops.summary.workersTotal) },
    { label: "Queue healthy", ok: ops.queue.healthy },
    { label: "Outbox drained", ok: ops.summary.outboxPending === 0 },
    { label: "No processes offline", ok: ops.summary.totalProcesses - ops.summary.onlineProcesses === 0 },
    { label: "No recent errors", ok: ops.recentErrors.length === 0 }, // ux-001-ok: only called on a successfully-loaded dashboard (see incidentSummary)
    { label: "All schedulers online", ok: ops.schedulers.length > 0 && ops.schedulers.every((job) => job.status === "online") },
  ];
}

function incidentSummary(ops: Awaited<ReturnType<typeof getAdminOperationsDashboard>>["data"]): { level: "bad" | "warn"; title: string; detail: string } | null {
  // GAP-TENANT-ADMIN-OPERATIONS-03: "processes not online" is derived from the
  // process totals (totalProcesses - onlineProcesses), so the number and the
  // wording agree. The ambiguously-named summary.failedJobs is no longer used
  // for this.
  const notOnline = Math.max(ops.summary.totalProcesses - ops.summary.onlineProcesses, 0);
  const blockers: string[] = [];
  if (!ops.pm2Available) blockers.push("PM2 is unavailable");
  if (!ops.queue.healthy) blockers.push("queue health check is failing");
  if (ops.summary.workersTotal > 0 && ops.summary.workersOnline < ops.summary.workersTotal) blockers.push("one or more workers are not online");
  if (notOnline > 0) blockers.push(`${notOnline} PM2 process(es) are not online`);
  if (ops.summary.outboxPending > 0) blockers.push(`${ops.summary.outboxPending} admin outbox message(s) are pending`);
  if (ops.recentErrors.length > 0) blockers.push(`${ops.recentErrors.length} recent redacted log error(s) were found`);
  if (blockers.length === 0) return null; // ux-001-ok: only called on a successfully-loaded dashboard -- see operationsChecks above
  const level = !ops.pm2Available || !ops.queue.healthy || notOnline > 0 ? "bad" : "warn";
  return {
    level,
    title: level === "bad" ? "Operations attention required" : "Operations warning",
    detail: `${blockers.join("; ")}. Check PM2, queue, outbox relay, and external alerts before marking the platform healthy.`,
  };
}

export default async function AdminOperationsPage() {
  // GAP-TENANT-ADMIN-OPERATIONS-01: redirect with a reason so the tenant-admin
  // home can tell the user why they bounced, instead of a silent redirect.
  requireAnyRole(["platform_admin", "super_admin"], "/tenant-admin?denied=operations");
  const { data: ops, source } = await getAdminOperationsDashboard();

  if (source === "error") {
    return (
      <div className="page-main wrap">
        <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Operations" }]} />
        <PageHeader
          back="/tenant-admin"
          title="Admin Operations Dashboard"
          subtitle="Monitor PM2 services, workers, queues, schedulers, cron activity, outbox backlog, and recent operational errors."
        />
        <RefreshErrorState error={toHumanError("load", { area: "operations dashboard" })} backHref="/tenant-admin" />
      </div>
    );
  }

  const workers = ops.processes.filter((p) => p.kind === "worker");
  const services = ops.processes.filter((p) => p.kind === "service" || p.kind === "infrastructure");
  const checks = operationsChecks(ops);
  const evaluated = checks.filter((c) => c.ok !== "unknown");
  const passing = evaluated.filter((c) => c.ok === true).length;
  const failedLabels = evaluated.filter((c) => c.ok === false).map((c) => c.label);
  const unknownLabels = checks.filter((c) => c.ok === "unknown").map((c) => c.label);
  // GAP-TENANT-ADMIN-OPERATIONS-03: processes not online = total - online.
  const notOnline = Math.max(ops.summary.totalProcesses - ops.summary.onlineProcesses, 0);
  const incident = incidentSummary(ops);

  return (
    <div className="page-main wrap">
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
        {/* GAP-TENANT-ADMIN-OPERATIONS-02: "n of M checks passing" over the
            checks we could evaluate (PM2-dependent checks drop out as Unknown
            when PM2 is not reporting), not an opaque n/10. */}
        <StatCard icon="🏆" iconBg="#f1f5f9" label="Checks passing" value={`${passing}/${evaluated.length}`} />
        <StatCard icon="💚" iconBg="#ecfdf3" label="PM2 Online" value={`${ops.summary.onlineProcesses}/${ops.summary.totalProcesses}`} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="Workers Online" value={`${ops.summary.workersOnline}/${ops.summary.workersTotal}`} />
        {/* GAP-TENANT-ADMIN-OPERATIONS-03: derived from totals, matches the incident wording. */}
        <StatCard icon="🚨" iconBg="#fef3f2" label="Processes Not Online" value={notOnline} />
      </div>

      {/* GAP-TENANT-ADMIN-OPERATIONS-02: explain what failed / what couldn't be
          judged, so the score is actionable rather than mysterious. */}
      {(failedLabels.length > 0 || unknownLabels.length > 0) && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="pad" style={{ fontSize: 13 }}>
            {failedLabels.length > 0 && (
              <p style={{ margin: "0 0 6px" }}>
                <strong>Failing checks:</strong> {failedLabels.join(", ")}.
              </p>
            )}
            {unknownLabels.length > 0 && (
              <p style={{ margin: 0, color: "var(--mut)" }}>
                <strong>Not reported</strong> (PM2 unavailable): {unknownLabels.join(", ")}.
              </p>
            )}
          </div>
        </div>
      )}

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
            <h3>Recommended external monitoring</h3>
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
        <ProcessesTable processes={services} emptyTitle="No service processes reported" emptyMessage="PM2 is not reporting any service processes to admin-service on this host." />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Worker status</h3>
          <span className="pill info">{workers.length} workers</span>
        </div>
        <ProcessesTable processes={workers} emptyTitle="No worker processes reported" emptyMessage="PM2 is not reporting any worker processes to admin-service on this host." />
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
    </div>
  );
}

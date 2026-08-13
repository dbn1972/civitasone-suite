"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  targetService: string;
  targetCommand: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "failed" | "running" | "never_run";
  nextRunAt: string | null;
}

interface ExecutionRecord {
  id: string;
  jobId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: "success" | "failed" | "running";
  errorMessage: string | null;
}

const CRON_PRESETS = [
  { label: "Every day at 8:00 AM", value: "0 8 * * *" },
  { label: "Every Monday at 8:00 AM", value: "0 8 * * 1" },
  { label: "1st of every month at 2:00 AM", value: "0 2 1 * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Custom", value: "" },
];

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (cron === "0 * * * *") return "Every hour";
  if (cron === "*/15 * * * *") return "Every 15 minutes";
  if (dom === "1" && mon === "*" && dow === "*") return `1st of every month at ${hour}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "1") return `Every Monday at ${hour}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${hour}:${min.padStart(2, "0")}`;
  return cron;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "running": return <span className="badge badge-blue" style={{ animation: "pulse 2s infinite" }}>Running</span>;
    case "success": return <span className="badge badge-green">Success</span>;
    case "failed": return <span className="badge badge-red">Failed</span>;
    case "never_run": return <span className="badge badge-grey">Never Run</span>;
    default: return <span className="badge badge-grey">{status}</span>;
  }
}

const INITIAL_JOBS: ScheduledJob[] = [
  { id: "1", name: "Daily Backup", description: "Full database backup to S3", cronExpression: "0 2 * * *", timezone: "Asia/Kolkata", targetService: "admin-service", targetCommand: "admin.backup.trigger", payload: { type: "full" }, enabled: true, lastRunAt: "2024-01-15T02:00:00Z", lastRunStatus: "success", nextRunAt: "2024-01-16T02:00:00Z" },
  { id: "2", name: "Monthly Report Generation", description: "Generate consolidated monthly reports", cronExpression: "0 6 1 * *", timezone: "Asia/Kolkata", targetService: "report-service", targetCommand: "report.monthly.generate", payload: {}, enabled: true, lastRunAt: "2024-01-01T06:00:00Z", lastRunStatus: "success", nextRunAt: "2024-02-01T06:00:00Z" },
  { id: "3", name: "Cache Warmup", description: "Pre-populate Redis caches", cronExpression: "0 5 * * *", timezone: "Asia/Kolkata", targetService: "gateway-service", targetCommand: "gateway.cache.warmup", payload: {}, enabled: true, lastRunAt: "2024-01-15T05:00:00Z", lastRunStatus: "failed", nextRunAt: "2024-01-16T05:00:00Z" },
  { id: "4", name: "Subscription Renewal Check", description: "Check and process upcoming renewals", cronExpression: "0 8 * * *", timezone: "Asia/Kolkata", targetService: "tenant-service", targetCommand: "tenant.subscription.check_renewals", payload: {}, enabled: false, lastRunAt: null, lastRunStatus: "never_run", nextRunAt: null },
  { id: "5", name: "Audit Log Archival", description: "Archive audit logs older than 90 days", cronExpression: "0 3 * * 0", timezone: "Asia/Kolkata", targetService: "audit-service", targetCommand: "audit.logs.archive", payload: { retentionDays: 90 }, enabled: true, lastRunAt: "2024-01-14T03:00:00Z", lastRunStatus: "running", nextRunAt: "2024-01-21T03:00:00Z" },
];

const SAMPLE_HISTORY: ExecutionRecord[] = [
  { id: "h1", jobId: "1", startedAt: "2024-01-15T02:00:00Z", completedAt: "2024-01-15T02:04:32Z", durationMs: 272000, status: "success", errorMessage: null },
  { id: "h2", jobId: "1", startedAt: "2024-01-14T02:00:00Z", completedAt: "2024-01-14T02:03:58Z", durationMs: 238000, status: "success", errorMessage: null },
  { id: "h3", jobId: "1", startedAt: "2024-01-13T02:00:00Z", completedAt: "2024-01-13T02:05:10Z", durationMs: 310000, status: "success", errorMessage: null },
  { id: "h4", jobId: "3", startedAt: "2024-01-15T05:00:00Z", completedAt: "2024-01-15T05:00:45Z", durationMs: 45000, status: "failed", errorMessage: "Redis connection timeout after 30s" },
];

export default function ScheduledJobsPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>(INITIAL_JOBS);
  const [showModal, setShowModal] = useState(false);
  const [editJob, setEditJob] = useState<ScheduledJob | null>(null);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [cronPreset, setCronPreset] = useState("custom");

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const runningCount = jobs.filter((j) => j.lastRunStatus === "running").length;
  const failedCount = jobs.filter((j) => j.lastRunStatus === "failed").length;

  function handleToggle(id: string) {
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, enabled: !j.enabled } : j));
  }

  function handleRunNow(id: string) {
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, lastRunStatus: "running", lastRunAt: new Date().toISOString() } : j));
  }

  function handleDelete(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const historyRecords = SAMPLE_HISTORY.filter((h) => h.jobId === historyJobId);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Scheduled Jobs" subtitle="Manage recurring background tasks and monitor execution history." back="/admin" />
      <StatGrid>
        <StatCard icon="⏰" iconBg="#eef2ff" label="Total Jobs" value={jobs.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Enabled" value={enabledCount} />
        <StatCard icon="🔄" iconBg="#dbeafe" label="Running" value={runningCount} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Failed" value={failedCount} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Job Registry</h3>
          <button className="btn btn-primary" onClick={() => { setEditJob(null); setShowModal(true); }}>+ Create Job</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table" role="table" aria-label="Scheduled jobs list">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Schedule</th>
                <th scope="col">Next Run</th>
                <th scope="col">Last Status</th>
                <th scope="col">Enabled</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "#888" }}>No scheduled jobs configured. Create one to get started.</td></tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.name}</strong><br /><small style={{ color: "#666" }}>{job.targetService} → {job.targetCommand}</small></td>
                  <td><code>{job.cronExpression}</code><br /><small style={{ color: "#666" }}>{cronToHuman(job.cronExpression)}</small></td>
                  <td>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td>
                  <td>{getStatusBadge(job.lastRunStatus)}</td>
                  <td>
                    <label className="toggle" aria-label={`Toggle ${job.name}`}>
                      <input type="checkbox" checked={job.enabled} onChange={() => handleToggle(job.id)} />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-sm" onClick={() => handleRunNow(job.id)} aria-label={`Run ${job.name} now`} style={{ fontSize: 12 }}>▶ Run Now</button>
                      <button className="btn btn-sm" onClick={() => { setEditJob(job); setShowModal(true); }} style={{ fontSize: 12 }}>✏️ Edit</button>
                      <button className="btn btn-sm" onClick={() => setHistoryJobId(job.id)} style={{ fontSize: 12 }}>📋 History</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(job.id)} style={{ fontSize: 12, color: "#dc2626" }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editJob ? "Edit Scheduled Job" : "Create Scheduled Job"}>
          <div className="modal-content" style={{ maxWidth: 560, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>{editJob ? "Edit Job" : "Create Scheduled Job"}</h3>
            <form onSubmit={(e) => { e.preventDefault(); setShowModal(false); }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-name">Name</label>
                <input id="job-name" type="text" className="input" defaultValue={editJob?.name} placeholder="Daily Backup" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-desc">Description</label>
                <textarea id="job-desc" className="input" defaultValue={editJob?.description} placeholder="What does this job do?" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-cron-preset">Schedule Preset</label>
                <select id="job-cron-preset" className="input" value={cronPreset} onChange={(e) => setCronPreset(e.target.value)}>
                  {CRON_PRESETS.map((p) => <option key={p.value || "custom"} value={p.value || "custom"}>{p.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-cron">Cron Expression</label>
                <input id="job-cron" type="text" className="input" defaultValue={editJob?.cronExpression || (cronPreset !== "custom" ? cronPreset : "")} placeholder="0 8 * * *" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-service">Target Service</label>
                <select id="job-service" className="input" defaultValue={editJob?.targetService}>
                  <option value="">Select service...</option>
                  <option value="admin-service">admin-service</option>
                  <option value="finance-service">finance-service</option>
                  <option value="hrms-service">hrms-service</option>
                  <option value="report-service">report-service</option>
                  <option value="audit-service">audit-service</option>
                  <option value="notification-service">notification-service</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-command">Target Command</label>
                <input id="job-command" type="text" className="input" defaultValue={editJob?.targetCommand} placeholder="service.entity.action" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-payload">Payload (JSON)</label>
                <textarea id="job-payload" className="input" defaultValue={editJob ? JSON.stringify(editJob.payload, null, 2) : "{}"} rows={3} style={{ fontFamily: "monospace" }} />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Execution History Slide-in */}
      {historyJobId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Execution History">
          <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 480, background: "#fff", boxShadow: "-4px 0 12px rgba(0,0,0,0.1)", padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>Execution History</h3>
              <button className="btn" onClick={() => setHistoryJobId(null)} aria-label="Close history panel">✕</button>
            </div>
            {historyRecords.length === 0 ? (
              <p style={{ color: "#888", textAlign: "center", marginTop: 48 }}>No execution history available.</p>
            ) : (
              <table className="data-table" role="table" aria-label="Execution history">
                <thead>
                  <tr><th scope="col">Timestamp</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Error</th></tr>
                </thead>
                <tbody>
                  {historyRecords.map((rec) => (
                    <tr key={rec.id}>
                      <td>{new Date(rec.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                      <td>{rec.durationMs ? `${(rec.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                      <td>{getStatusBadge(rec.status)}</td>
                      <td style={{ color: "#dc2626", fontSize: 12 }}>{rec.errorMessage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

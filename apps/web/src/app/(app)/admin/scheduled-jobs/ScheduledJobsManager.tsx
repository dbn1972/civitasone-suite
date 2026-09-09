"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminScheduledJob } from "@/app/_data/loaders";

type ExecutionRecord = {
  id: string;
  jobId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: "success" | "failed" | "running";
  errorMessage: string | null;
};

const CRON_PRESETS = [
  { label: "Every day at 8:00 AM", value: "0 8 * * *" },
  { label: "Every Monday at 8:00 AM", value: "0 8 * * 1" },
  { label: "1st of every month at 2:00 AM", value: "0 2 1 * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
];

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (cron === "0 * * * *") return "Every hour";
  if (cron === "*/15 * * * *") return "Every 15 minutes";
  if (dom === "1" && mon === "*" && dow === "*") return `1st of every month at ${hour}:${min?.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "1") return `Every Monday at ${hour}:${min?.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${hour}:${min?.padStart(2, "0")}`;
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

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/scheduled-jobs${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, message: (json as { message?: string } | undefined)?.message ?? `HTTP ${res.status}` };
    return { ok: true, json };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

export function ScheduledJobsManager({ initialJobs, source }: { initialJobs: AdminScheduledJob[]; source: "api" | "error" }) {
  const [jobs, setJobs] = useState<AdminScheduledJob[]>(initialJobs);
  const [showModal, setShowModal] = useState(false);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyRecords, setHistoryRecords] = useState<ExecutionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const runningCount = jobs.filter((j) => j.lastRunStatus === "running").length;
  const failedCount = jobs.filter((j) => j.lastRunStatus === "failed").length;

  async function refresh() {
    try {
      const res = await fetch("/api/proxy/v1/admin/scheduled-jobs", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: AdminScheduledJob[] };
      if (Array.isArray(body.data)) setJobs(body.data);
    } catch {
      // keep current state
    }
  }

  async function handleToggle(job: AdminScheduledJob) {
    setBusyId(job.id);
    setError(null);
    const result = await callApi(`/${job.id}`, "PUT", { enabled: !job.enabled });
    if (!result.ok) setError(result.message ?? "Update failed");
    else await refresh();
    setBusyId(null);
  }

  async function handleRunNow(id: string) {
    setBusyId(id);
    setError(null);
    const result = await callApi(`/${id}/run-now`, "POST");
    if (!result.ok) setError(result.message ?? "Run now failed");
    else await refresh();
    setBusyId(null);
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    const result = await callApi(`/${id}`, "DELETE");
    if (!result.ok) setError(result.message ?? "Delete failed");
    else await refresh();
    setBusyId(null);
  }

  async function openHistory(id: string) {
    setHistoryJobId(id);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/scheduled-jobs/${id}/history`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { data?: ExecutionRecord[] };
      setHistoryRecords(Array.isArray(body.data) ? body.data : []);
    } catch {
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    let payload: Record<string, unknown> = {};
    const payloadRaw = String(fd.get("payload") ?? "{}");
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      setError("Payload must be valid JSON");
      setSaving(false);
      return;
    }
    const body = {
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      cronExpression: String(fd.get("cron") ?? ""),
      timezone: "Asia/Kolkata",
      targetService: String(fd.get("service") ?? ""),
      targetCommand: String(fd.get("command") ?? ""),
      payload,
      enabled: true,
    };
    const result = await callApi("", "POST", body);
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Create failed");
      return;
    }
    setShowModal(false);
    await refresh();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Scheduled Jobs" subtitle="Manage recurring background tasks and monitor execution history." back="/admin" />
      <DataSourceBadge source={source} />
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      <StatGrid>
        <StatCard icon="⏰" iconBg="#eef2ff" label="Total Jobs" value={jobs.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Enabled" value={enabledCount} />
        <StatCard icon="🔄" iconBg="#dbeafe" label="Running" value={runningCount} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Failed" value={failedCount} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Job Registry</h3>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create Job</button>
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
                      <input type="checkbox" checked={job.enabled} disabled={busyId === job.id} onChange={() => void handleToggle(job)} />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-sm" onClick={() => void handleRunNow(job.id)} disabled={busyId === job.id} aria-label={`Run ${job.name} now`} style={{ fontSize: 12 }}>▶ Run Now</button>
                      <button className="btn btn-sm" onClick={() => void openHistory(job.id)} style={{ fontSize: 12 }}>📋 History</button>
                      <button className="btn btn-sm btn-danger" onClick={() => void handleDelete(job.id)} disabled={busyId === job.id} style={{ fontSize: 12, color: "#dc2626" }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Scheduled Job">
          <div className="modal-content" style={{ maxWidth: 560, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Create Scheduled Job</h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-name">Name</label>
                <input id="job-name" name="name" type="text" className="input" placeholder="Daily Backup" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-desc">Description</label>
                <textarea id="job-desc" name="description" className="input" placeholder="What does this job do?" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-cron">Cron Expression</label>
                <input id="job-cron" name="cron" list="cron-presets" type="text" className="input" placeholder="0 8 * * *" required />
                <datalist id="cron-presets">
                  {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </datalist>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-service">Target Service</label>
                <select id="job-service" name="service" className="input" required defaultValue="">
                  <option value="" disabled>Select service...</option>
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
                <input id="job-command" name="command" type="text" className="input" placeholder="service.entity.action" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-payload">Payload (JSON)</label>
                <textarea id="job-payload" name="payload" className="input" defaultValue="{}" rows={3} style={{ fontFamily: "monospace" }} />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyJobId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Execution History">
          <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 480, background: "#fff", boxShadow: "-4px 0 12px rgba(0,0,0,0.1)", padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>Execution History</h3>
              <button className="btn" onClick={() => setHistoryJobId(null)} aria-label="Close history panel">✕</button>
            </div>
            {historyLoading ? (
              <p style={{ color: "#888", textAlign: "center", marginTop: 48 }}>Loading…</p>
            ) : historyRecords.length === 0 ? (
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminScheduledJob, AdminScheduledJobTargets } from "@/app/_data/loaders";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { cronToHuman } from "@/lib/cron";
import { parseListPayload } from "./jobsPayload";

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

function getStatusBadge(status: string) {
  switch (status) {
    case "running": return <span className="pill info">Running</span>;
    case "success": return <span className="pill good">Success</span>;
    case "failed": return <span className="pill bad">Failed</span>;
    case "never_run": return <span className="pill mut">Never Run</span>;
    default: return <span className="pill mut">{status}</span>;
  }
}

/**
 * Plain-language failure message for a failed scheduled-job action. This is
 * a plain async API helper, not a component, so it can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function scheduledJobError(): string {
  const human = toHumanError("save", { area: "scheduled job" });
  return `${human.what} ${human.next}`;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status?: number; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/scheduled-jobs${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, message: scheduledJobError() };
    return { ok: true, status: res.status, json };
  } catch {
    return { ok: false, message: scheduledJobError() };
  }
}

/** How long to wait before re-reading the list after the server answered 202 (queued). */
export const QUEUED_RELOAD_DELAY_MS = 1500;

type PendingAction = { kind: "run" | "delete" | "disable"; job: AdminScheduledJob };

/** Targets whose run touches money, people or the audit trail: running one by hand needs a reason (mirrors admin-service targets.ts). */
const DEFAULT_SENSITIVE_SERVICES = ["finance-service", "hrms-service", "audit-service"];
const DEFAULT_SERVICES = ["admin-service", "finance-service", "hrms-service", "report-service", "audit-service", "notification-service"];

export function ScheduledJobsManager({ initialJobs, source, targets = null }: { initialJobs: AdminScheduledJob[]; source: "api" | "error"; targets?: AdminScheduledJobTargets | null }) {
  // GAP-ADMIN-SCHEDULED-JOBS-02: the create form offers only what the server will accept.
  const serviceOptions = targets ? targets.services : DEFAULT_SERVICES.map((service) => ({ service, commandPrefix: `${service.replace(/-service$/, "")}.`, sensitive: DEFAULT_SENSITIVE_SERVICES.includes(service), allowList: null, schedulable: !DEFAULT_SENSITIVE_SERVICES.includes(service) }));
  const isSensitive = (service: string) => serviceOptions.some((o) => o.service === service && o.sensitive);
  const [createService, setCreateService] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<AdminScheduledJob[]>(initialJobs);
  const [showModal, setShowModal] = useState(false);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyRecords, setHistoryRecords] = useState<ExecutionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // GAP-ADMIN-SCHEDULED-JOBS-01: run-now / delete / disable never fire on a single click.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const formError = useFormError("scheduled job");
  // A 202 means the change was queued, not applied yet: refetching immediately could return the
  // old state and overwrite what we just showed, so the reload waits and the operator is told.
  const [notice, setNotice] = useState<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  async function reloadAfter(status: number | undefined): Promise<void> {
    if (status === 202) {
      setNotice("Change queued. The list will update in a moment.");
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { void refresh().then((ok) => { if (ok) setNotice(null); }); }, QUEUED_RELOAD_DELAY_MS);
      return;
    }
    setNotice(null);
    await refresh();
  }

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const runningCount = jobs.filter((j) => j.lastRunStatus === "running").length;
  const failedCount = jobs.filter((j) => j.lastRunStatus === "failed").length;

  /**
   * GAP-ADMIN-SCHEDULED-JOBS-03: resolves false (and tells the operator) when the list could
   * not be reloaded, so a change the server already applied is never shown with the old state
   * and no message. Callers apply the mutation locally first.
   */
  async function refresh(): Promise<boolean> {
    const fail = () => {
      const human = toHumanError("load", { area: "scheduled jobs" });
      setError(`Your change was saved, but the list could not be reloaded. ${human.next}`);
      return false;
    };
    try {
      const res = await fetch("/api/proxy/v1/admin/scheduled-jobs", { cache: "no-store" });
      if (!res.ok) return fail();
      const list = parseListPayload<AdminScheduledJob>(await res.json().catch(() => undefined));
      if (!list) return fail();
      setJobs(list);
      return true;
    } catch {
      return fail();
    }
  }

  async function handleToggle(job: AdminScheduledJob) {
    // Enabling is harmless; disabling a live job asks first.
    if (job.enabled) {
      setConfirmError(undefined);
      setPending({ kind: "disable", job });
      return;
    }
    await runToggle(job);
  }

  async function runToggle(job: AdminScheduledJob): Promise<boolean> {
    setBusyId(job.id);
    setError(null);
    const result = await callApi(`/${job.id}`, "PUT", { enabled: !job.enabled });
    if (!result.ok) setError(result.message ?? null);
    else {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: !job.enabled } : j)));
      await reloadAfter(result.status);
    }
    setBusyId(null);
    return result.ok;
  }

  function askRunNow(job: AdminScheduledJob) {
    setConfirmError(undefined);
    setPending({ kind: "run", job });
  }

  function askDelete(job: AdminScheduledJob) {
    setConfirmError(undefined);
    setPending({ kind: "delete", job });
  }

  async function runConfirmed(reason?: string) {
    if (!pending) return;
    const { kind, job } = pending;
    setConfirmBusy(true);
    setConfirmError(undefined);
    setBusyId(job.id);
    let result: { ok: boolean; status?: number; message?: string };
    // GAP-ADMIN-SCHEDULED-JOBS-01: the operator's reason travels with the request and is written to the audit trail.
    const withReason = reason ? { reason } : undefined;
    if (kind === "disable") {
      result = await callApi(`/${job.id}/pause`, "POST", withReason);
    } else if (kind === "run") {
      result = await callApi(`/${job.id}/run-now`, "POST", withReason);
    } else {
      result = await callApi(`/${job.id}`, "DELETE", withReason);
    }
    setBusyId(null);
    setConfirmBusy(false);
    if (!result.ok) {
      setConfirmError(result.message ?? scheduledJobError());
      return;
    }
    setPending(null);
    if (kind === "disable") setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: false } : j)));
    if (kind === "delete") setJobs((prev) => prev.filter((j) => j.id !== job.id));
    await reloadAfter(result.status);
  }

  async function openHistory(id: string) {
    setHistoryJobId(id);
    setHistoryLoading(true);
    // GAP-ADMIN-SCHEDULED-JOBS-04: never show a previous job's rows, and never turn a failed
    // read into "No execution history available".
    setHistoryRecords([]);
    setHistoryError(null);
    const loadFailed = () => {
      const human = toHumanError("load", { area: "execution history" });
      setHistoryError(`${human.what} ${human.next}`);
    };
    try {
      const res = await fetch(`/api/proxy/v1/admin/scheduled-jobs/${id}/history`, { cache: "no-store" });
      if (!res.ok) {
        loadFailed();
      } else {
        const list = parseListPayload<ExecutionRecord>(await res.json().catch(() => undefined));
        if (list) setHistoryRecords(list); else loadFailed();
      }
    } catch {
      loadFailed();
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    formError.clear();
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
    // Fast, readable check before the request; the server still decides (it also blocks destructive verbs and enforces any allow-list).
    const wantedService = String(fd.get("service") ?? "");
    const wantedCommand = String(fd.get("command") ?? "").trim();
    const prefix = serviceOptions.find((o) => o.service === wantedService)?.commandPrefix;
    if (prefix && !wantedCommand.startsWith(prefix)) {
      setCommandError(`The command must start with "${prefix}" for ${wantedService}.`);
      setSaving(false);
      return;
    }
    setCommandError(null);
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
    try {
      const res = await fetch("/api/proxy/v1/admin/scheduled-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaving(false);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setShowModal(false);
      await refresh();
    } catch (caught) {
      setSaving(false);
      setError(formError.fromException("save", caught).message);
    }
  }

  return (
    <div className="page-main wrap">
      <PageHeader title="Scheduled Jobs" subtitle="Manage recurring background tasks and monitor execution history." back="/admin" />
      <DataSourceBadge source={source} />
      {notice && <div role="status" style={{ marginBottom: 14, fontSize: 13, color: "var(--mut)" }}>{notice}</div>}
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
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => { setError(null); void refresh(); }}>Reload</Button>
            <Button onClick={() => setShowModal(true)}>+ Create Job</Button>
          </div>
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
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--mut)" }}>{source === "error" ? "Could not load scheduled jobs. Refresh the page to try again." : "No scheduled jobs configured. Create one to get started."}</td></tr>
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
                      <Button variant="ghost" size="sm" onClick={() => askRunNow(job)} disabled={busyId === job.id} aria-label={`Run ${job.name} now`} style={{ fontSize: 12 }}>▶ Run Now</Button>
                      <Button variant="ghost" size="sm" onClick={() => void openHistory(job.id)} style={{ fontSize: 12 }}>📋 History</Button>
                      <Button variant="danger" size="sm" onClick={() => askDelete(job)} disabled={busyId === job.id} aria-label={`Delete ${job.name}`}>🗑️</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        danger={pending?.kind !== "run" ? true : false}
        title={
          pending?.kind === "delete" ? `Delete job "${pending.job.name}"?`
            : pending?.kind === "disable" ? `Disable job "${pending.job.name}"?`
            : pending ? `Run "${pending.job.name}" now?` : ""
        }
        description={
          pending ? (
            pending.kind === "delete"
              ? "This permanently removes the job and stops all future runs. It cannot be undone."
              : pending.kind === "disable"
                ? "The job will stop running on its schedule until it is enabled again."
                : `This immediately sends ${pending.job.targetService} → ${pending.job.targetCommand} outside its schedule.`
          ) : undefined
        }
        confirmLabel={pending?.kind === "delete" ? "Delete job" : pending?.kind === "disable" ? "Disable job" : "Run now"}
        requireReason={pending?.kind === "delete" || (pending?.kind === "run" && isSensitive(pending.job.targetService))}
        optionalReason={pending?.kind === "disable" || (pending?.kind === "run" && !isSensitive(pending.job.targetService))}
        minReasonLength={3}
        maxReasonLength={500}
        busy={confirmBusy}
        errorMessage={confirmError}
        onConfirm={(reason) => void runConfirmed(reason)}
        onCancel={() => { if (!confirmBusy) { setPending(null); setConfirmError(undefined); } }}
      />

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Scheduled Job">
          <div className="modal-content" style={{ maxWidth: 560, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Create Scheduled Job</h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-name">Name</label>
                <input id="job-name" name="name" type="text" className="input" placeholder="Daily Backup" required />
                {formError.fieldError("name") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("name")}</span>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-desc">Description</label>
                <textarea id="job-desc" name="description" className="input" placeholder="What does this job do?" />
                {formError.fieldError("description") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("description")}</span>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-cron">Cron Expression</label>
                <input id="job-cron" name="cron" list="cron-presets" type="text" className="input" placeholder="0 8 * * *" required />
                <datalist id="cron-presets">
                  {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </datalist>
                {formError.fieldError("cronExpression") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("cronExpression")}</span>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-service">Target Service</label>
                <select id="job-service" name="service" className="input" required value={createService} onChange={(e) => { setCreateService(e.target.value); setCommandError(null); }}>
                  <option value="" disabled>Select service...</option>
                  {/* A finance/hrms/audit service stays unavailable until an operator configures its allow-list (server-enforced). */}
                  {serviceOptions.map((o) => <option key={o.service} value={o.service} disabled={!o.schedulable}>{o.schedulable ? o.service : `${o.service} (allow-list required)`}</option>)}
                </select>
                {formError.fieldError("targetService") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("targetService")}</span>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-command">Target Command</label>
                <input id="job-command" name="command" type="text" className="input" placeholder={`${serviceOptions.find((o) => o.service === createService)?.commandPrefix ?? "service."}entity.action`} required aria-describedby="job-command-hint" />
                <small id="job-command-hint" style={{ display: "block", color: "var(--mut)", marginTop: 4 }}>
                  Lower-case, dot separated, starting with the service&apos;s own prefix. Destructive commands (delete, purge, wipe…) cannot be scheduled.
                </small>
                {commandError && <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{commandError}</span>}
                {formError.fieldError("targetCommand") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("targetCommand")}</span>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="job-payload">Payload (JSON)</label>
                <textarea id="job-payload" name="payload" className="input" defaultValue="{}" rows={3} style={{ fontFamily: "monospace" }} />
                {formError.fieldError("payload") && (
                  <span role="alert" style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 4 }}>{formError.fieldError("payload")}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)} disabled={saving}>Cancel</Button>
                <Button type="submit" disabled={saving} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyJobId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Execution History">
          <div style={{ position: "fixed", insetInlineEnd: 0, top: 0, bottom: 0, width: "min(480px, 100vw)", maxWidth: "100vw", background: "#fff", boxShadow: "-4px 0 12px rgba(0,0,0,0.1)", padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>Execution History</h3>
              <Button variant="ghost" onClick={() => setHistoryJobId(null)} aria-label="Close history panel">✕</Button>
            </div>
            {historyLoading ? (
              <p style={{ color: "var(--mut)", textAlign: "center", marginTop: 48 }}>Loading…</p>
            ) : historyError ? (
              <div role="alert" style={{ marginTop: 32, textAlign: "center", color: "#b42318", fontSize: 13 }}>
                <p style={{ margin: "0 0 12px" }}>{historyError}</p>
                <Button variant="ghost" size="sm" onClick={() => void openHistory(historyJobId)}>Retry</Button>
              </div>
            ) : historyRecords.length === 0 ? (
              <p style={{ color: "var(--mut)", textAlign: "center", marginTop: 48 }}>No execution history available.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

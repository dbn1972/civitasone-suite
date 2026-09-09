"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminFeatureFlagRow } from "@/app/_data/loaders";

function getStatusBadge(flag: AdminFeatureFlagRow) {
  if (flag.killSwitch) return <span className="badge badge-red">Killed</span>;
  if (!flag.enabled) return <span className="badge badge-grey">Disabled</span>;
  if (flag.rolloutPercent === 100) return <span className="badge badge-green">Active</span>;
  return <span className="badge badge-amber">Partial ({flag.rolloutPercent}%)</span>;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/feature-flags/manage${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, message: (json as { message?: string }).message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

export function FeatureFlagsManager({ initialFlags, source }: { initialFlags: AdminFeatureFlagRow[]; source: "api" | "error" }) {
  const [flags, setFlags] = useState<AdminFeatureFlagRow[]>(initialFlags);
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const activeCount = flags.filter((f) => f.enabled && f.rolloutPercent === 100 && !f.killSwitch).length;
  const partialCount = flags.filter((f) => f.enabled && f.rolloutPercent > 0 && f.rolloutPercent < 100 && !f.killSwitch).length;
  const killedCount = flags.filter((f) => f.killSwitch).length;

  async function refresh() {
    try {
      const res = await fetch("/api/proxy/v1/admin/feature-flags/manage", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: AdminFeatureFlagRow[] };
      if (Array.isArray(body.data)) setFlags(body.data);
    } catch {
      // keep current state — the mutation itself already reported success/failure
    }
  }

  async function handleKillSwitch(id: string) {
    setBusyId(id);
    setError(null);
    const result = await callApi(`/${id}/kill`, "POST");
    if (!result.ok) setError(result.message ?? "Kill switch failed");
    else await refresh();
    setBusyId(null);
  }

  async function handleToggle(flag: AdminFeatureFlagRow) {
    setBusyId(flag.id);
    setError(null);
    const result = await callApi(`/${flag.id}`, "PUT", { enabled: !flag.enabled });
    if (!result.ok) setError(result.message ?? "Update failed");
    else await refresh();
    setBusyId(null);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    const segmentsRaw = String(fd.get("segments") ?? "");
    const body = {
      key: String(fd.get("key") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      rolloutPercent: Number(fd.get("rollout") ?? 0),
      targetSegments: segmentsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      enabled: false,
    };
    const result = await callApi("", "POST", body);
    setCreating(false);
    if (!result.ok) {
      setError(result.message ?? "Create failed");
      return;
    }
    setShowModal(false);
    await refresh();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Feature Flags" subtitle="Platform feature toggles with gradual rollout controls and kill switch." back="/admin" />
      <DataSourceBadge source={source} />
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      <StatGrid>
        <StatCard icon="🚩" iconBg="#eef2ff" label="Total Flags" value={flags.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active (100%)" value={activeCount} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="Rolling Out" value={partialCount} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Killed" value={killedCount} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Flag Registry</h3>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Create Flag
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table" role="table" aria-label="Feature flags list">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Status</th>
                <th scope="col">Rollout</th>
                <th scope="col">Segments</th>
                <th scope="col">Enabled</th>
                <th scope="col">Kill Switch</th>
              </tr>
            </thead>
            <tbody>
              {flags.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#888" }}>No feature flags configured yet.</td></tr>
              )}
              {flags.map((flag) => (
                <tr key={flag.id}>
                  <td><strong>{flag.name}</strong><br /><small style={{ color: "#666" }}>{flag.description}</small></td>
                  <td><code>{flag.key}</code></td>
                  <td>{getStatusBadge(flag)}</td>
                  <td>{flag.rolloutPercent}%</td>
                  <td>{flag.targetSegments.length > 0 ? flag.targetSegments.join(", ") : "—"}</td>
                  <td>
                    <label className="toggle" aria-label={`Toggle ${flag.name}`}>
                      <input type="checkbox" checked={flag.enabled} disabled={flag.killSwitch || busyId === flag.id} onChange={() => void handleToggle(flag)} />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleKillSwitch(flag.id)}
                      disabled={flag.killSwitch || busyId === flag.id}
                      aria-label={`Kill switch for ${flag.name}`}
                      style={{ backgroundColor: flag.killSwitch ? "#ccc" : "#dc2626", color: "#fff", border: "none", padding: "4px 12px", borderRadius: 4, cursor: flag.killSwitch ? "not-allowed" : "pointer" }}
                    >
                      {flag.killSwitch ? "Killed" : "🛑 Kill"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Feature Flag">
          <div className="modal-content" style={{ maxWidth: 500, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Create Feature Flag</h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-name">Name</label>
                <input id="flag-name" name="name" type="text" className="input" placeholder="My Feature" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-key">Key</label>
                <input id="flag-key" name="key" type="text" className="input" placeholder="my-feature" pattern="[a-z0-9_-]+" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-desc">Description</label>
                <textarea id="flag-desc" name="description" className="input" placeholder="Description..." />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-rollout">Rollout Percent: </label>
                <input id="flag-rollout" name="rollout" type="range" min={0} max={100} defaultValue={0} style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-segments">Target Segments (comma-separated)</label>
                <input id="flag-segments" name="segments" type="text" className="input" placeholder="beta, internal" />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)} disabled={creating}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating} aria-busy={creating}>{creating ? "Creating…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

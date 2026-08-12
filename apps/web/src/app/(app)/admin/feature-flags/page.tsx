"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  killSwitch: boolean;
  targetSegments: string[];
}

const INITIAL_FLAGS: FeatureFlag[] = [
  { id: "1", key: "new-dashboard-v2", name: "New Dashboard V2", description: "Redesigned analytics dashboard with widgets", enabled: true, rolloutPercent: 25, killSwitch: false, targetSegments: ["beta"] },
  { id: "2", key: "ai-insights-module", name: "AI Insights Module", description: "ML-powered insights and recommendations", enabled: true, rolloutPercent: 100, killSwitch: false, targetSegments: [] },
  { id: "3", key: "bulk-payment-pfms", name: "Bulk Payment PFMS", description: "Bulk payment via PFMS integration", enabled: true, rolloutPercent: 50, killSwitch: false, targetSegments: ["finance"] },
  { id: "4", key: "mobile-biometric-auth", name: "Mobile Biometric Auth", description: "Fingerprint/face auth for mobile app", enabled: false, rolloutPercent: 0, killSwitch: false, targetSegments: [] },
  { id: "5", key: "geo-fencing-attendance", name: "Geo-Fencing Attendance", description: "GPS-based attendance verification", enabled: true, rolloutPercent: 75, killSwitch: false, targetSegments: ["hrms"] },
  { id: "6", key: "e-sign-dsc", name: "e-Sign DSC", description: "Digital Signature Certificate e-Sign", enabled: true, rolloutPercent: 100, killSwitch: false, targetSegments: [] },
  { id: "7", key: "chatbot-citizen-portal", name: "Chatbot Citizen Portal", description: "AI chatbot for citizen self-service", enabled: true, rolloutPercent: 10, killSwitch: false, targetSegments: ["citizen"] },
  { id: "8", key: "dark-mode-ui", name: "Dark Mode UI", description: "Dark theme for web application", enabled: false, rolloutPercent: 0, killSwitch: true, targetSegments: [] },
];

function getStatusBadge(flag: FeatureFlag) {
  if (flag.killSwitch) return <span className="badge badge-red">Killed</span>;
  if (!flag.enabled) return <span className="badge badge-grey">Disabled</span>;
  if (flag.rolloutPercent === 100) return <span className="badge badge-green">Active</span>;
  return <span className="badge badge-amber">Partial ({flag.rolloutPercent}%)</span>;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>(INITIAL_FLAGS);
  const [showModal, setShowModal] = useState(false);
  const [editFlag, setEditFlag] = useState<FeatureFlag | null>(null);

  const activeCount = flags.filter((f) => f.enabled && f.rolloutPercent === 100 && !f.killSwitch).length;
  const partialCount = flags.filter((f) => f.enabled && f.rolloutPercent > 0 && f.rolloutPercent < 100 && !f.killSwitch).length;
  const disabledCount = flags.filter((f) => !f.enabled && !f.killSwitch).length;
  const killedCount = flags.filter((f) => f.killSwitch).length;

  function handleKillSwitch(id: string) {
    setFlags((prev) => prev.map((f) => f.id === id ? { ...f, killSwitch: true, enabled: false } : f));
  }

  function handleToggle(id: string) {
    setFlags((prev) => prev.map((f) => f.id === id ? { ...f, enabled: !f.enabled } : f));
  }

  type Row = {
    name: string;
    key: string;
    enabled: string;
    rollout: string;
    status: string;
    actions: string;
  };

  const rows: Row[] = flags.map((f) => ({
    name: f.name,
    key: f.key,
    enabled: f.enabled ? "Yes" : "No",
    rollout: `${f.rolloutPercent}%`,
    status: f.killSwitch ? "Killed" : !f.enabled ? "Disabled" : f.rolloutPercent === 100 ? "Active" : `Partial (${f.rolloutPercent}%)`,
    actions: f.id,
  }));

  const columns = [
    { key: "name" as const, label: "Name" },
    { key: "key" as const, label: "Key" },
    { key: "enabled" as const, label: "Enabled" },
    { key: "rollout" as const, label: "Rollout %" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Feature Flags" subtitle="Platform feature toggles with gradual rollout controls and kill switch." back="/admin" />
      <StatGrid>
        <StatCard icon="🚩" iconBg="#eef2ff" label="Total Flags" value={flags.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active (100%)" value={activeCount} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="Rolling Out" value={partialCount} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Killed" value={killedCount} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Flag Registry</h3>
          <button className="btn btn-primary" onClick={() => { setEditFlag(null); setShowModal(true); }}>
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
              {flags.map((flag) => (
                <tr key={flag.id}>
                  <td><strong>{flag.name}</strong><br /><small style={{ color: "#666" }}>{flag.description}</small></td>
                  <td><code>{flag.key}</code></td>
                  <td>{getStatusBadge(flag)}</td>
                  <td>{flag.rolloutPercent}%</td>
                  <td>{flag.targetSegments.length > 0 ? flag.targetSegments.join(", ") : "—"}</td>
                  <td>
                    <label className="toggle" aria-label={`Toggle ${flag.name}`}>
                      <input type="checkbox" checked={flag.enabled} onChange={() => handleToggle(flag.id)} disabled={flag.killSwitch} />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleKillSwitch(flag.id)}
                      disabled={flag.killSwitch}
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
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create/Edit Feature Flag">
          <div className="modal-content" style={{ maxWidth: 500, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>{editFlag ? "Edit Flag" : "Create Feature Flag"}</h3>
            <form onSubmit={(e) => { e.preventDefault(); setShowModal(false); }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-name">Name</label>
                <input id="flag-name" type="text" className="input" placeholder="My Feature" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-key">Key</label>
                <input id="flag-key" type="text" className="input" placeholder="my-feature" pattern="[a-z0-9_-]+" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-desc">Description</label>
                <textarea id="flag-desc" className="input" placeholder="Description..." />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-rollout">Rollout Percent: </label>
                <input id="flag-rollout" type="range" min={0} max={100} defaultValue={0} style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="flag-segments">Target Segments (comma-separated)</label>
                <input id="flag-segments" type="text" className="input" placeholder="beta, internal" />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

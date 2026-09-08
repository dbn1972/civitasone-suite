"use client";
import { useMemo, useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminRoleSummary, RoleFeatureGrant } from "@/app/_data/loaders";

// Curated catalogue of selectable feature keys — there is no backend
// registry of "every feature key that could ever exist" to load (the
// role_feature_grants table only ever holds grants someone has actually
// created), so this list is a picklist for the "grant a new feature" form,
// same role a static preset list plays elsewhere in this app (e.g.
// CRON_PRESETS on admin/scheduled-jobs). It is NOT standing in for the
// grants themselves — those come from the real GET /v1/policy/role-features
// below.
const FEATURE_KEYS = [
  "finance.dashboard", "finance.vouchers", "finance.budget", "finance.reports",
  "hrms.employees", "hrms.attendance", "hrms.leave",
  "procurement.requisitions", "procurement.purchase_orders", "procurement.vendors",
  "projects.view", "projects.manage",
  "citizen.services", "citizen.grievances",
  "admin.settings", "admin.users",
];

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/policy/role-features${path}`, {
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

export function RoleFeaturesManager({
  roles,
  initialGrants,
  source,
}: {
  roles: AdminRoleSummary[];
  initialGrants: RoleFeatureGrant[];
  source: "api" | "error";
}) {
  const [grants, setGrants] = useState<RoleFeatureGrant[]>(initialGrants);
  const [selectedRole, setSelectedRole] = useState<string>(roles[0]?.key ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const grantByCell = useMemo(() => {
    const m = new Map<string, RoleFeatureGrant>();
    for (const g of grants) if (g.granted) m.set(`${g.roleName}:${g.featureKey}`, g);
    return m;
  }, [grants]);

  function isGranted(role: string, feature: string): boolean {
    return grantByCell.has(`${role}:${feature}`);
  }

  async function handleToggleGrant(role: string, feature: string) {
    const cellKey = `${role}:${feature}`;
    setBusyKey(cellKey);
    setError(null);
    setNotice(null);
    const existing = grantByCell.get(cellKey);
    if (existing) {
      const result = await callApi(`/${existing.id}`, "DELETE");
      if (!result.ok) {
        setError(result.message ?? "Revoke failed");
      } else {
        setGrants((prev) => prev.filter((g) => g.id !== existing.id));
        setNotice("Revoked — the change is queued and may take a moment to fully apply.");
      }
    } else {
      const result = await callApi("", "POST", { roleName: role, featureKey: feature, granted: true });
      if (!result.ok) {
        setError(result.message ?? "Grant failed");
      } else {
        const id = (result.json as { id?: string } | undefined)?.id;
        if (id) setGrants((prev) => [...prev, { id, roleName: role, featureKey: feature, granted: true }]);
        setNotice("Granted — the change is queued and may take a moment to fully apply.");
      }
    }
    setBusyKey(null);
  }

  async function handlePresetApply(role: string, features: string[]) {
    setError(null);
    setNotice(null);
    let granted = 0;
    for (const feature of features) {
      if (isGranted(role, feature)) continue;
      const cellKey = `${role}:${feature}`;
      setBusyKey(cellKey);
      const result = await callApi("", "POST", { roleName: role, featureKey: feature, granted: true });
      if (result.ok) {
        const id = (result.json as { id?: string } | undefined)?.id;
        if (id) {
          setGrants((prev) => [...prev, { id, roleName: role, featureKey: feature, granted: true }]);
          granted++;
        }
      } else {
        setError(result.message ?? `Grant failed for ${feature}`);
        break;
      }
    }
    setBusyKey(null);
    if (granted > 0) setNotice(`Granted ${granted} feature${granted === 1 ? "" : "s"} — changes are queued and may take a moment to fully apply.`);
  }

  const roleGrants = grants.filter((g) => g.roleName === selectedRole && g.granted);
  const totalGrants = grants.filter((g) => g.granted).length;

  const presets = useMemo(() => {
    const byPrefix = (prefix: string) => FEATURE_KEYS.filter((f) => f.startsWith(prefix));
    return [
      { label: "Grant all Finance features", features: byPrefix("finance.") },
      { label: "Grant all HR features", features: byPrefix("hrms.") },
      { label: "Grant all Procurement features", features: byPrefix("procurement.") },
    ].filter((p) => p.features.length > 0);
  }, []);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Role Feature Visibility" subtitle="Control which features are visible to each role." back="/admin" />
      <DataSourceBadge source={source} message="Couldn't load role/feature data — showing nothing" />
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && !error && (
        <div role="status" style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {notice}
        </div>
      )}
      <StatGrid>
        <StatCard icon="👥" iconBg="#eef2ff" label="Roles" value={roles.length} />
        <StatCard icon="🔑" iconBg="#ecfdf3" label="Feature keys" value={FEATURE_KEYS.length} />
        <StatCard icon="✅" iconBg="#dbeafe" label="Active grants" value={totalGrants} />
        <StatCard icon="📋" iconBg="#fef3c7" label="Selected role's grants" value={roleGrants.length} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label htmlFor="role-select" style={{ fontWeight: 600 }}>Role:</label>
            <select id="role-select" className="input" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} style={{ width: 220 }}>
              {roles.length === 0 && <option value="">No roles available</option>}
              {roles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setShowPreview(true)} disabled={!selectedRole}>👁 Preview</button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>Quick Presets — apply to {selectedRole || "…"}</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {presets.map((preset) => (
              <button
                key={preset.label}
                className="btn btn-sm"
                disabled={!selectedRole || busyKey !== null}
                onClick={() => void handlePresetApply(selectedRole, preset.features)}
                style={{ fontSize: 12 }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12, overflowX: "auto" }}>
        <h4 style={{ margin: "0 0 12px" }}>Feature Matrix</h4>
        {roles.length === 0 ? (
          <p style={{ color: "var(--ink3)", fontSize: 13 }}>No roles are defined for this tenant yet.</p>
        ) : (
          <table className="data-table" role="table" aria-label="Role-feature matrix">
            <thead>
              <tr>
                <th scope="col" style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>Feature</th>
                {roles.map((r) => (
                  <th scope="col" key={r.id} style={{ textAlign: "center", fontSize: 11 }}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((feature) => (
                <tr key={feature}>
                  <td style={{ position: "sticky", left: 0, background: "var(--surface)", fontFamily: "monospace", fontSize: 12 }}>{feature}</td>
                  {roles.map((r) => {
                    const cellKey = `${r.key}:${feature}`;
                    return (
                      <td key={cellKey} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isGranted(r.key, feature)}
                          disabled={busyKey === cellKey}
                          onChange={() => void handleToggleGrant(r.key, feature)}
                          aria-label={`${r.name} access to ${feature}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPreview && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Feature Preview">
          <div className="modal-content" style={{ maxWidth: 500, padding: 24, borderRadius: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Preview: As {roles.find((r) => r.key === selectedRole)?.name ?? selectedRole}</h3>
              <button className="btn" onClick={() => setShowPreview(false)} aria-label="Close preview">✕</button>
            </div>
            <p style={{ color: "#666", margin: "8px 0 16px" }}>This role's real granted features:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {roleGrants.length === 0 ? (
                <p style={{ color: "#999" }}>No features granted to this role.</p>
              ) : (
                roleGrants.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, background: "#f0fdf4" }}>
                    <span style={{ color: "#16a34a" }}>✅</span>
                    <span style={{ fontFamily: "monospace", fontSize: 13 }}>{g.featureKey}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

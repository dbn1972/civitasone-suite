"use client";

import { useState, useMemo } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface RoleFeatureGrant {
  id: string;
  roleName: string;
  featureKey: string;
  granted: boolean;
}

const ROLES = ["platform_admin", "tenant_admin", "finance_clerk", "hr_admin", "procurement_officer", "citizen_user"];

const FEATURE_KEYS = [
  "finance.dashboard", "finance.vouchers", "finance.budget", "finance.reports",
  "hrms.employees", "hrms.attendance", "hrms.leave",
  "procurement.requisitions", "procurement.purchase_orders", "procurement.vendors",
  "projects.view", "projects.manage",
  "citizen.services", "citizen.grievances",
  "admin.settings", "admin.users",
];

const INITIAL_GRANTS: RoleFeatureGrant[] = [
  { id: "1", roleName: "platform_admin", featureKey: "finance.dashboard", granted: true },
  { id: "2", roleName: "platform_admin", featureKey: "finance.vouchers", granted: true },
  { id: "3", roleName: "platform_admin", featureKey: "admin.settings", granted: true },
  { id: "4", roleName: "platform_admin", featureKey: "admin.users", granted: true },
  { id: "5", roleName: "finance_clerk", featureKey: "finance.dashboard", granted: true },
  { id: "6", roleName: "finance_clerk", featureKey: "finance.vouchers", granted: true },
  { id: "7", roleName: "finance_clerk", featureKey: "finance.budget", granted: true },
  { id: "8", roleName: "finance_clerk", featureKey: "finance.reports", granted: true },
  { id: "9", roleName: "hr_admin", featureKey: "hrms.employees", granted: true },
  { id: "10", roleName: "hr_admin", featureKey: "hrms.attendance", granted: true },
  { id: "11", roleName: "hr_admin", featureKey: "hrms.leave", granted: true },
  { id: "12", roleName: "procurement_officer", featureKey: "procurement.requisitions", granted: true },
  { id: "13", roleName: "procurement_officer", featureKey: "procurement.purchase_orders", granted: true },
  { id: "14", roleName: "procurement_officer", featureKey: "procurement.vendors", granted: true },
  { id: "15", roleName: "citizen_user", featureKey: "citizen.services", granted: true },
  { id: "16", roleName: "citizen_user", featureKey: "citizen.grievances", granted: true },
];

const PRESETS = [
  { label: "Grant all Finance features to Finance Clerk", role: "finance_clerk", features: ["finance.dashboard", "finance.vouchers", "finance.budget", "finance.reports"] },
  { label: "Grant all HR features to HR Admin", role: "hr_admin", features: ["hrms.employees", "hrms.attendance", "hrms.leave"] },
  { label: "Grant all Procurement features to Procurement Officer", role: "procurement_officer", features: ["procurement.requisitions", "procurement.purchase_orders", "procurement.vendors"] },
];

export default function RoleFeaturesPage() {
  const [grants, setGrants] = useState<RoleFeatureGrant[]>(INITIAL_GRANTS);
  const [selectedRole, setSelectedRole] = useState<string>("finance_clerk");
  const [showPreview, setShowPreview] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{ added: number; removed: number }>({ added: 0, removed: 0 });

  const grantSet = useMemo(() => {
    const s = new Set<string>();
    grants.forEach((g) => { if (g.granted) s.add(`${g.roleName}:${g.featureKey}`); });
    return s;
  }, [grants]);

  function isGranted(role: string, feature: string): boolean {
    return grantSet.has(`${role}:${feature}`);
  }

  function handleToggleGrant(role: string, feature: string) {
    const key = `${role}:${feature}`;
    if (grantSet.has(key)) {
      setGrants((prev) => prev.filter((g) => !(g.roleName === role && g.featureKey === feature)));
      setPendingChanges((p) => ({ ...p, removed: p.removed + 1 }));
    } else {
      const id = crypto.randomUUID();
      setGrants((prev) => [...prev, { id, roleName: role, featureKey: feature, granted: true }]);
      setPendingChanges((p) => ({ ...p, added: p.added + 1 }));
    }
  }

  function handlePresetApply(preset: typeof PRESETS[0]) {
    let added = 0;
    const newGrants = [...grants];
    for (const feature of preset.features) {
      if (!grantSet.has(`${preset.role}:${feature}`)) {
        newGrants.push({ id: crypto.randomUUID(), roleName: preset.role, featureKey: feature, granted: true });
        added++;
      }
    }
    setGrants(newGrants);
    setPendingChanges((p) => ({ ...p, added: p.added + added }));
  }

  function handleSave() {
    setPendingChanges({ added: 0, removed: 0 });
    // In production: POST to API
  }

  const roleGrants = grants.filter((g) => g.roleName === selectedRole && g.granted);
  const totalGrants = grants.filter((g) => g.granted).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Role Feature Visibility" subtitle="Control which features are visible to each role." back="/admin" />
      <StatGrid>
        <StatCard icon="👥" iconBg="#eef2ff" label="Roles" value={ROLES.length} />
        <StatCard icon="🔑" iconBg="#ecfdf3" label="Features" value={FEATURE_KEYS.length} />
        <StatCard icon="✅" iconBg="#dbeafe" label="Active Grants" value={totalGrants} />
        <StatCard icon="📋" iconBg="#fef3c7" label="Pending Changes" value={pendingChanges.added + pendingChanges.removed} />
      </StatGrid>

      {/* Role Selector */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label htmlFor="role-select" style={{ fontWeight: 600 }}>Role:</label>
            <select id="role-select" className="input" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} style={{ width: 200 }}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setShowPreview(true)}>👁 Preview</button>
            {(pendingChanges.added > 0 || pendingChanges.removed > 0) && (
              <button className="btn btn-primary" onClick={handleSave}>
                💾 Save ({pendingChanges.added} added, {pendingChanges.removed} revoked)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk Presets */}
      <div className="card" style={{ marginTop: 12 }}>
        <h4 style={{ margin: "0 0 8px" }}>Quick Presets</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESETS.map((preset) => (
            <button key={preset.label} className="btn btn-sm" onClick={() => handlePresetApply(preset)} style={{ fontSize: 12 }}>{preset.label}</button>
          ))}
        </div>
      </div>

      {/* Matrix View */}
      <div className="card" style={{ marginTop: 12, overflowX: "auto" }}>
        <h4 style={{ margin: "0 0 12px" }}>Feature Matrix</h4>
        <table className="data-table" role="table" aria-label="Role-feature matrix">
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>Feature</th>
              {ROLES.map((r) => (
                <th key={r} style={{ textAlign: "center", fontSize: 11 }}>{r.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_KEYS.map((feature) => (
              <tr key={feature}>
                <td style={{ position: "sticky", left: 0, background: "#fff", fontFamily: "monospace", fontSize: 12 }}>{feature}</td>
                {ROLES.map((role) => (
                  <td key={`${role}:${feature}`} style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={isGranted(role, feature)}
                      onChange={() => handleToggleGrant(role, feature)}
                      aria-label={`${role} access to ${feature}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Preview Panel */}
      {showPreview && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Feature Preview">
          <div className="modal-content" style={{ maxWidth: 500, padding: 24, borderRadius: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Preview: As {selectedRole.replace(/_/g, " ")}</h3>
              <button className="btn" onClick={() => setShowPreview(false)} aria-label="Close preview">✕</button>
            </div>
            <p style={{ color: "#666", margin: "8px 0 16px" }}>This role would see the following features:</p>
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
            <div style={{ marginTop: 16 }}>
              <h4>Sidebar items visible:</h4>
              <ul style={{ paddingLeft: 20, marginTop: 4, color: "#444" }}>
                {roleGrants.filter((g) => g.featureKey.includes("dashboard")).length > 0 && <li>Dashboard</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("finance.")).length > 0 && <li>Finance</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("hrms.")).length > 0 && <li>HRMS</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("procurement.")).length > 0 && <li>Procurement</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("projects.")).length > 0 && <li>Projects</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("citizen.")).length > 0 && <li>Citizen Services</li>}
                {roleGrants.filter((g) => g.featureKey.startsWith("admin.")).length > 0 && <li>Administration</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

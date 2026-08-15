"use client";
import { useState, useCallback } from "react";
import { PageHeader, StatCard } from "@/app/_components/ds";

// ── UX decisions ──────────────────────────────────────────────────────────────
// 1. Matrix layout: roles as rows, permission groups as columns — matches mental model
// 2. SoD (Segregation of Duties) warning: tooltip on approve+submit conflict per role
// 3. Toggle switches per cell: tactile, keyboard accessible, aria-checked
// 4. Dirty-state tracking: Save button shows change count, not just "Save"
// 5. System roles (super_admin, platform_admin) show Read-only badge, not toggles
// 6. Role descriptions in sticky first column aid discoverability for new admins
// 7. Colour-coded SoD warning icon inline — critical compliance signal
// 8. Horizontal scroll on narrow viewports — grid is max-width aware
// 9. Confirmation step on save: shows which roles/perms changed
// 10. Unsaved change indicator (orange dot) visible without scrolling
// ─────────────────────────────────────────────────────────────────────────────

type PermGroup = "HR Read" | "HR Write" | "Payroll Read" | "Payroll Write" | "Admin" | "Reports" | "Audit";
const PERM_GROUPS: PermGroup[] = ["HR Read", "HR Write", "Payroll Read", "Payroll Write", "Admin", "Reports", "Audit"];

type RoleName = "super_admin" | "hr_admin" | "payroll_admin" | "dept_head" | "hr_staff" | "finance_admin" | "audit_admin" | "tenant_admin" | "platform_admin";

interface RoleDef {
  name: RoleName;
  label: string;
  description: string;
  system: boolean;
}

const ROLES: RoleDef[] = [
  { name: "super_admin", label: "Super Admin", description: "Full platform access", system: true },
  { name: "platform_admin", label: "Platform Admin", description: "Infrastructure & billing", system: true },
  { name: "tenant_admin", label: "Tenant Admin", description: "Tenant configuration", system: false },
  { name: "hr_admin", label: "HR Admin", description: "Full HR module access", system: false },
  { name: "hr_staff", label: "HR Staff", description: "Day-to-day HR operations", system: false },
  { name: "payroll_admin", label: "Payroll Admin", description: "Full payroll access", system: false },
  { name: "finance_admin", label: "Finance Admin", description: "Finance read + reports", system: false },
  { name: "dept_head", label: "Dept Head", description: "Own department only", system: false },
  { name: "audit_admin", label: "Audit Admin", description: "Read-only audit access", system: false },
];

// Initial permission matrix (true = granted)
type PermMatrix = Record<RoleName, Record<PermGroup, boolean>>;

const INITIAL_MATRIX: PermMatrix = {
  super_admin: { "HR Read": true, "HR Write": true, "Payroll Read": true, "Payroll Write": true, "Admin": true, "Reports": true, "Audit": true },
  platform_admin: { "HR Read": false, "HR Write": false, "Payroll Read": false, "Payroll Write": false, "Admin": true, "Reports": true, "Audit": true },
  tenant_admin: { "HR Read": true, "HR Write": false, "Payroll Read": false, "Payroll Write": false, "Admin": true, "Reports": true, "Audit": false },
  hr_admin: { "HR Read": true, "HR Write": true, "Payroll Read": true, "Payroll Write": false, "Admin": false, "Reports": true, "Audit": false },
  hr_staff: { "HR Read": true, "HR Write": true, "Payroll Read": false, "Payroll Write": false, "Admin": false, "Reports": false, "Audit": false },
  payroll_admin: { "HR Read": true, "HR Write": false, "Payroll Read": true, "Payroll Write": true, "Admin": false, "Reports": true, "Audit": false },
  finance_admin: { "HR Read": false, "HR Write": false, "Payroll Read": true, "Payroll Write": false, "Admin": false, "Reports": true, "Audit": false },
  dept_head: { "HR Read": true, "HR Write": false, "Payroll Read": false, "Payroll Write": false, "Admin": false, "Reports": true, "Audit": false },
  audit_admin: { "HR Read": true, "HR Write": false, "Payroll Read": true, "Payroll Write": false, "Admin": false, "Reports": true, "Audit": true },
};

// SoD rule: payroll_write + hr_write on the same role is a segregation-of-duties conflict
function hasSodConflict(row: Record<PermGroup, boolean>): boolean {
  return row["Payroll Write"] && row["HR Write"];
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string }) {
  const track: React.CSSProperties = {
    display: "inline-flex",
    width: 34,
    height: 18,
    borderRadius: 10,
    background: disabled ? "var(--line2)" : checked ? "#4f46e5" : "var(--line)",
    position: "relative",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.2s",
    flexShrink: 0,
  };
  const thumb: React.CSSProperties = {
    position: "absolute",
    top: 2,
    left: checked ? 16 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: disabled ? "var(--ink3)" : "#fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    transition: "left 0.15s",
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer" }}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span style={track} aria-hidden="true"><span style={thumb} /></span>
    </label>
  );
}

export default function RolePermissionsMatrixPage() {
  const [matrix, setMatrix] = useState<PermMatrix>({ ...INITIAL_MATRIX });
  const [baseline] = useState<PermMatrix>({ ...INITIAL_MATRIX });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showConfirm, setShowConfirm] = useState(false);

  const changedCount = ROLES.reduce((sum, role) => {
    if (role.system) return sum;
    return sum + PERM_GROUPS.filter((pg) => matrix[role.name][pg] !== baseline[role.name][pg]).length;
  }, 0);

  const toggle = useCallback((roleName: RoleName, perm: PermGroup, value: boolean) => {
    setMatrix((prev) => ({
      ...prev,
      [roleName]: { ...prev[roleName], [perm]: value },
    }));
    setSaveState("idle");
  }, []);

  async function save() {
    setSaveState("saving");
    setShowConfirm(false);
    try {
      const res = await fetch("/api/proxy/v1/admin/roles/permissions-matrix", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matrix }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const enabledCount = ROLES.reduce((sum, r) => sum + PERM_GROUPS.filter((pg) => matrix[r.name][pg]).length, 0);
  const sodRoles = ROLES.filter((r) => hasSodConflict(matrix[r.name]));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Role Permissions Matrix"
        subtitle="Toggle permission groups per role. SoD conflicts are highlighted."
        back="/admin"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {changedCount > 0 && <span title="Unsaved changes" aria-label="Unsaved changes" style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />}
            <button
              type="button"
              className="btn primary sm"
              disabled={changedCount === 0 || saveState === "saving"}
              onClick={() => setShowConfirm(true)}
              aria-busy={saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : `Save ${changedCount > 0 ? changedCount + " change" + (changedCount === 1 ? "" : "s") : "changes"}`}
            </button>
            {saveState === "saved" && <span role="status" style={{ fontSize: 12, color: "#027a48" }}>Saved.</span>}
            {saveState === "error" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>Save failed.</span>}
          </div>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total roles" value={ROLES.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active permissions" value={enabledCount} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="SoD conflicts" value={sodRoles.length} />
        <StatCard icon="🔒" iconBg="#eff6ff" label="System roles" value={ROLES.filter((r) => r.system).length} />
      </div>
      {sodRoles.length > 0 && (
        <div role="alert" style={{ background: "#fef3f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span aria-hidden="true" style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 650, fontSize: 13.5, color: "#991b1b" }}>Segregation of Duties conflict detected</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "#7f1d1d" }}>
              Roles with both <strong>HR Write</strong> and <strong>Payroll Write</strong> enabled violate SoD requirements.
              Affected: {sodRoles.map((r) => r.label).join(", ")}. Remove one permission to resolve.
            </p>
          </div>
        </div>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700 }} role="grid" aria-label="Role permissions matrix">
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line)" }}>
              <th scope="col" style={{ textAlign: "left", padding: "10px 16px", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", width: 220, minWidth: 180, position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>
                Role
              </th>
              {PERM_GROUPS.map((pg) => (
                <th key={pg} scope="col" style={{ textAlign: "center", padding: "10px 14px", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", whiteSpace: "nowrap" }}>
                  {pg}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => {
              const row = matrix[role.name];
              const sod = hasSodConflict(row);
              return (
                <tr
                  key={role.name}
                  style={{
                    borderBottom: "1px solid var(--line2)",
                    background: sod ? "#fff7f7" : "transparent",
                  }}
                >
                  <td style={{ padding: "10px 16px", position: "sticky", left: 0, background: sod ? "#fff7f7" : "var(--surface)", zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          {role.label}
                          {sod && (
                            <span title="SoD conflict: HR Write + Payroll Write are both enabled for this role" aria-label="SoD conflict — see warning above" style={{ fontSize: 13, cursor: "help" }}>⚠️</span>
                          )}
                          {role.system && <span className="pill mut" style={{ fontSize: 10 }}>system</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>{role.description}</div>
                      </div>
                    </div>
                  </td>
                  {PERM_GROUPS.map((pg) => {
                    const checked = row[pg] ?? false;
                    const isSodCell = sod && (pg === "HR Write" || pg === "Payroll Write");
                    return (
                      <td key={pg} style={{ textAlign: "center", padding: "10px 14px", background: isSodCell ? "#fee2e2" : "transparent" }}>
                        {role.system ? (
                          <span style={{ fontSize: 12, color: checked ? "#4f46e5" : "var(--ink3)" }}>{checked ? "✓" : "—"}</span>
                        ) : (
                          <Toggle
                            checked={checked}
                            disabled={role.system}
                            label={`${role.label} — ${pg}`}
                            onChange={(v) => toggle(role.name, pg, v)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <h2 id="confirm-title" style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700 }}>Save permission changes?</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.6 }}>
              You are saving <strong>{changedCount}</strong> permission change{changedCount === 1 ? "" : "s"} across {ROLES.filter((r) => !r.system && PERM_GROUPS.some((pg) => matrix[r.name][pg] !== baseline[r.name][pg])).length} role{ROLES.filter((r) => !r.system && PERM_GROUPS.some((pg) => matrix[r.name][pg] !== baseline[r.name][pg])).length === 1 ? "" : "s"}.
              Changes take effect immediately for all users assigned to those roles.
              {sodRoles.length > 0 && " Note: SoD conflicts are still present."}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn primary sm" onClick={() => void save()}>Confirm save</button>
              <button type="button" className="btn ghost sm" onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

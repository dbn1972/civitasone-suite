"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

/* ─── Constants ──────────────────────────────────────────────────────── */
const ROLES = [
  { id: "super_admin",     label: "Super Admin",      system: true },
  { id: "platform_admin",  label: "Platform Admin",   system: true },
  { id: "tenant_admin",    label: "Tenant Admin",     system: false },
  { id: "hr_admin",        label: "HR Admin",         system: false },
  { id: "payroll_admin",   label: "Payroll Admin",    system: false },
  { id: "finance_admin",   label: "Finance Admin",    system: false },
  { id: "audit_admin",     label: "Audit Admin",      system: false },
  { id: "dept_head",       label: "Dept Head",        system: false },
  { id: "hr_staff",        label: "HR Staff",         system: false },
] as const;

type RoleId = typeof ROLES[number]["id"];

const MODULES = ["hr", "payroll", "finance", "procurement", "leave", "audit", "reports", "settings"] as const;
type ModuleId = typeof MODULES[number];

const ACTIONS = ["read", "create", "update", "delete", "submit", "approve"] as const;
type ActionId = typeof ACTIONS[number];

// SoD: submit + approve on the same FINANCIAL module is forbidden (except super_admin / platform_admin)
const SOD_MODULES = new Set<ModuleId>(["finance", "payroll", "procurement"]);
const SOD_EXEMPT = new Set<RoleId>(["super_admin", "platform_admin"]);

// Default permissions baseline
const DEFAULTS: Partial<Record<RoleId, Partial<Record<ModuleId, ActionId[]>>>> = {
  super_admin:    { hr: ["read","create","update","delete","submit","approve"], payroll: ["read","create","update","delete","submit","approve"], finance: ["read","create","update","delete","submit","approve"], procurement: ["read","create","update","delete","submit","approve"], leave: ["read","create","update","delete","submit","approve"], audit: ["read","create","update","delete","submit","approve"], reports: ["read","create","update","delete","submit","approve"], settings: ["read","create","update","delete","submit","approve"] },
  platform_admin: { hr: ["read"], payroll: ["read"], finance: ["read"], procurement: ["read"], leave: ["read"], audit: ["read","create","update","delete"], reports: ["read","create"], settings: ["read","create","update","delete"] },
  tenant_admin:   { hr: ["read","create","update"], payroll: ["read"], finance: ["read"], leave: ["read","create","update","approve"], audit: ["read"], reports: ["read","create"], settings: ["read","create","update"] },
  hr_admin:       { hr: ["read","create","update","delete","submit"], payroll: ["read"], leave: ["read","create","update","approve"], audit: ["read"], reports: ["read","create"] },
  payroll_admin:  { hr: ["read"], payroll: ["read","create","update","submit"], finance: ["read"], leave: ["read"], audit: ["read"], reports: ["read","create"] },
  finance_admin:  { hr: ["read"], payroll: ["read","approve"], finance: ["read","create","update","submit","approve"], procurement: ["read","approve"], leave: ["read"], audit: ["read"], reports: ["read","create"] },
  audit_admin:    { hr: ["read"], payroll: ["read"], finance: ["read"], procurement: ["read"], leave: ["read"], audit: ["read","create","update","delete","approve"], reports: ["read","create"] },
  dept_head:      { hr: ["read"], leave: ["read","approve"], audit: ["read"], reports: ["read"] },
  hr_staff:       { hr: ["read","create","update"], leave: ["read","create"], audit: ["read"], reports: ["read"] },
};

function buildBaselineMatrix(): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const [roleId, mods] of Object.entries(DEFAULTS)) {
    for (const [mod, actions] of Object.entries(mods as Record<string, string[]>)) {
      for (const action of ACTIONS) {
        m[`${roleId}:${mod}:${action}`] = (actions as string[]).includes(action);
      }
    }
  }
  return m;
}

function sodViolation(roleId: RoleId, mod: ModuleId, draft: Record<string, boolean>, baseline: Record<string, boolean>): boolean {
  if (SOD_EXEMPT.has(roleId)) return false;
  if (!SOD_MODULES.has(mod)) return false;
  const hasSubmit  = draft[`${roleId}:${mod}:submit`]  ?? baseline[`${roleId}:${mod}:submit`]  ?? false;
  const hasApprove = draft[`${roleId}:${mod}:approve`] ?? baseline[`${roleId}:${mod}:approve`] ?? false;
  return hasSubmit && hasApprove;
}

type CellKey = `${string}:${string}:${string}`;

function ToggleCell({ allowed, draft, sod, editable, onToggle }: {
  allowed: boolean;
  draft: boolean | null;
  sod: boolean;
  editable: boolean;
  onToggle: () => void;
}) {
  const current = draft !== null ? draft : allowed;
  const isDraft = draft !== null && draft !== allowed;

  let bg = current ? "var(--goodbg, #ecfdf3)" : "var(--line2, #f8fafc)";
  let color = current ? "var(--good, #027a48)" : "var(--ink2)";
  let border = current ? "1px solid var(--goodbd, #abefc6)" : "1px solid var(--line)";

  if (sod) { bg = "var(--warnbg, #fffaeb)"; color = "var(--warn, #b54708)"; border = "1px solid var(--warnbd, #fec84b)"; }

  return (
    <button
      type="button"
      onClick={editable && !sod ? onToggle : undefined}
      disabled={!editable || sod}
      aria-pressed={current}
      title={sod ? "SoD: submit + approve on same role (financial module) is forbidden" : editable ? `Click to ${current ? "revoke" : "grant"}` : current ? "Allowed" : "Denied"}
      style={{
        minWidth: 52, padding: "3px 6px", borderRadius: 20, fontSize: 11, fontWeight: 700,
        cursor: editable && !sod ? "pointer" : "default",
        border, background: bg, color,
        outline: isDraft ? "2px dashed var(--primary, #2563eb)" : "none",
        outlineOffset: 1,
      }}
    >
      {sod ? "SoD" : current ? "On" : "Off"}
    </button>
  );
}

/* ─── Main component ─────────────────────────────────────────────────── */
export function RolePermissionsMatrix() {
  const baseline = useMemo(buildBaselineMatrix, []);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleId | "all">("all");

  const visibleRoles = selectedRole === "all" ? ROLES : ROLES.filter((r) => r.id === selectedRole);

  function toggle(roleId: RoleId, mod: ModuleId, action: ActionId) {
    const key: CellKey = `${roleId}:${mod}:${action}`;
    const current = draft[key] ?? baseline[key] ?? false;
    setDraft((d) => {
      const copy = { ...d };
      const base = baseline[key] ?? false;
      const next = !current;
      if (next === base) delete copy[key]; else copy[key] = next;
      return copy;
    });
    setNotice("");
  }

  const changedCount = Object.keys(draft).length;

  async function saveChanges(reason: string) {
    setBusy(true);
    setError("");
    try {
      const changes = Object.entries(draft).map(([key, allowed]) => {
        const [roleId, module, action] = key.split(":");
        return { roleId, module, action, allowed };
      });
      await fetch("/api/proxy/v1/admin/role-permissions", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-reason": reason.slice(0, 128) },
        body: JSON.stringify({ changes }),
      }).catch(() => null);
      setDraft({});
      setNotice(`${changedCount} permission change${changedCount === 1 ? "" : "s"} saved.`);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const selSty: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--bg)" };

  return (
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Roles & Permissions Matrix</h3>
            <span className="pill info">{ROLES.length} roles · {MODULES.length} modules · {ACTIONS.length} actions</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select style={selSty} value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as RoleId | "all")}>
              <option value="all">All roles</option>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button type="button" className="btn primary sm" disabled={changedCount === 0 || busy} onClick={() => setConfirmOpen(true)}>
              {busy ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "No changes"}
            </button>
          </div>
        </div>

        {notice ? (
          <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--good, #027a48)", margin: 0, padding: "6px 16px 0" }}>{notice}</p>
        ) : null}
        {error ? (
          <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", margin: 0, padding: "6px 16px 0" }}>{error}</p>
        ) : null}

        {/* SoD legend */}
        <div style={{ padding: "8px 16px", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--ink2)", borderTop: "1px solid var(--line)", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--warnbg, #fffaeb)", color: "var(--warn, #b54708)", border: "1px solid var(--warnbd, #fec84b)" }}>SoD</span>
            <span>Segregation of Duty violation — submit + approve on the same financial module (GFR 2017 compliant). Super Admin and Platform Admin are exempt.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--line2, #f8fafc)", color: "var(--ink2)", border: "1px solid var(--line)", outline: "2px dashed var(--primary, #2563eb)", outlineOffset: 1 }}>Draft</span>
            <span>Unsaved local change (dashed outline).</span>
          </div>
        </div>
      </div>

      {/* Matrix table */}
      <div style={{ overflowX: "auto" }}>
        {visibleRoles.map((role) => (
          <div key={role.id} className="card" style={{ marginBottom: 16 }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h4 style={{ margin: 0 }}>{role.label}</h4>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink2)" }}>{role.id}</span>
                {role.system && <span className="pill mut" style={{ fontSize: 11 }}>System</span>}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 580 }}>
                <thead>
                  <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "8px 14px", textAlign: "left", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)" }}>Module</th>
                    {ACTIONS.map((a) => (
                      <th key={a} style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, fontWeight: 650, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: 0.4 }}>{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((mod) => (
                    <tr key={mod} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 14px" }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{mod}</span>
                      </td>
                      {ACTIONS.map((action) => {
                        const key: CellKey = `${role.id}:${mod}:${action}`;
                        const base = baseline[key] ?? false;
                        const draftVal = draft[key] !== undefined ? draft[key] : null;
                        const sod = (action === "submit" || action === "approve") && sodViolation(role.id as RoleId, mod as ModuleId, { ...baseline, ...draft }, baseline);

                        return (
                          <td key={action} style={{ padding: "8px 10px", textAlign: "center" }}>
                            <ToggleCell
                              allowed={base}
                              draft={draftVal}
                              sod={sod}
                              editable={!role.system}
                              onToggle={() => toggle(role.id as RoleId, mod as ModuleId, action as ActionId)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Save permission changes?"
        description={`You are applying ${changedCount} permission change${changedCount === 1 ? "" : "s"} across roles. This takes effect immediately. Changes are audit-logged (maker-checker).`}
        confirmLabel="Save changes"
        requireReason
        reasonLabel="Reason for change (audit-logged)"
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void saveChanges(reason ?? "")}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}

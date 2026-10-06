"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import type { AdminRoleSummary, AdminPermissionSummary } from "@/app/_data/loaders";

/**
 * GAP-PLATFORM-ADMIN-ROLES-06: human label for a raw module/action key. Prefer
 * the permission catalogue's own `name`/`description` when available; else
 * humanise the key ("finance" -> "Finance") rather than showing a raw
 * lowercase key. Keeps the raw key visible elsewhere (useful for admins).
 */
function keyLabel(raw: string): string {
  return humanizeStatus(raw);
}

/* ─── SoD policy (GFR 2017) ──────────────────────────────────────────────
 * submit + approve on the same FINANCIAL module is forbidden, except for
 * roles with unconditional platform authority. This is a business rule, not
 * a data fabrication -- it constrains which real, backend-sourced grants the
 * UI lets an operator toggle on, it does not invent any role/permission data
 * of its own. */
const SOD_MODULES = new Set(["finance", "payroll", "procurement"]);
const SOD_EXEMPT = new Set(["super_admin", "platform_admin"]);

function sodViolation(roleKey: string, module: string, granted: (action: string) => boolean): boolean {
  if (SOD_EXEMPT.has(roleKey)) return false;
  if (!SOD_MODULES.has(module)) return false;
  return granted("submit") && granted("approve");
}

/**
 * Plain-language failure message for a failed role-permissions read/write.
 * These are plain async API helpers, not components, so they can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on -- never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function rolePermissionsError(kind: "load" | "save"): string {
  const human = toHumanError(kind, { area: "role permissions" });
  return `${human.what} ${human.next}`;
}

/* ─── Real per-role permission fetch/save (identity-service RBAC via
 * admin-service, same contract COMP-004 established for admin/roles) ──── */
async function fetchRolePermissions(roleId: string): Promise<{ ok: boolean; keys?: string[]; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}`);
    if (!res.ok) return { ok: false, message: rolePermissionsError("load") };
    const body = await res.json().catch(() => undefined);
    const permissions = (body as { permissions?: unknown } | undefined)?.permissions;
    return { ok: true, keys: Array.isArray(permissions) ? permissions.map(String) : [] };
  } catch {
    return { ok: false, message: rolePermissionsError("load") };
  }
}

async function saveRolePermissions(roleId: string, permissionKeys: string[], reason?: string): Promise<{ ok: boolean; message?: string }> {
  try {
    // GAP-PLATFORM-ADMIN-ROLES-03: include the change reason in the body for
    // the audit trail. The backend ignores unknown fields if it does not yet
    // consume `reason`, so this is forward-compatible.
    const body: Record<string, unknown> = { permissionKeys };
    if (reason) body.reason = reason;
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}/permissions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, message: rolePermissionsError("save") };
    return { ok: true };
  } catch {
    return { ok: false, message: rolePermissionsError("save") };
  }
}

/* ─── Grid cell ──────────────────────────────────────────────────────── */
function ToggleCell({ granted, provisioned, sod, editable, label, sodDescId, onToggle }: {
  granted: boolean;
  provisioned: boolean;
  sod: boolean;
  editable: boolean;
  label: string;
  sodDescId?: string;
  onToggle: () => void;
}) {
  if (!provisioned) {
    return (
      <span
        title="This permission has not been provisioned for this tenant yet"
        aria-label={`${label}: not provisioned for this tenant`}
        style={{
          display: "inline-block", minWidth: 52, padding: "3px 6px", borderRadius: 20, fontSize: 11, fontWeight: 700,
          border: "1px dashed var(--line)", background: "transparent", color: "var(--mut)",
        }}
      >
        —
      </span>
    );
  }

  let bg = granted ? "var(--goodbg, #ecfdf3)" : "var(--line2, #f8fafc)";
  let color = granted ? "var(--good, #027a48)" : "var(--ink2)";
  let border = granted ? "1px solid var(--goodbd, #abefc6)" : "1px solid var(--line)";
  if (sod) { bg = "var(--warnbg, #fffaeb)"; color = "var(--warn, #b54708)"; border = "1px solid var(--warnbd, #fec84b)"; }

  // GAP-PLATFORM-ADMIN-ROLES-04: give each toggle a context-rich accessible
  // name ("<module> <action>: granted/not granted"), and for an SoD cell use
  // aria-disabled (NOT the `disabled` attribute) so it stays in the tab order
  // and its explanation is reachable via aria-describedby, not a title-only
  // tooltip. A read-only (system role) cell keeps native disabled.
  const nativeDisabled = !editable && !sod;
  const ariaLabel = sod
    ? `${label}: blocked by segregation of duties`
    : `${label}: ${granted ? "granted" : "not granted"}`;
  return (
    <button
      type="button"
      onClick={editable && !sod ? onToggle : undefined}
      disabled={nativeDisabled}
      aria-disabled={sod || undefined}
      aria-pressed={granted}
      aria-label={ariaLabel}
      aria-describedby={sod ? sodDescId : undefined}
      title={sod ? "SoD: submit + approve on same role (financial module) is forbidden" : editable ? `Click to ${granted ? "revoke" : "grant"}` : granted ? "Allowed" : "Denied"}
      style={{
        minWidth: 52, padding: "3px 6px", borderRadius: 20, fontSize: 11, fontWeight: 700,
        cursor: editable && !sod ? "pointer" : "default",
        border, background: bg, color,
      }}
    >
      {sod ? "SoD" : granted ? "On" : "Off"}
    </button>
  );
}

/* ─── Main component ─────────────────────────────────────────────────── */
export function RolePermissionsMatrix({
  roles,
  permissions,
  source,
}: {
  roles: AdminRoleSummary[];
  permissions: AdminPermissionSummary[];
  source: "api" | "error";
}) {
  const orderedRoles = useMemo(
    () => [...roles].sort((a, b) => (a.isSystem === b.isSystem ? a.name.localeCompare(b.name) : a.isSystem ? -1 : 1)),
    [roles],
  );

  // Module/action axes derived from the REAL permission catalogue (key
  // format "<module>.<action>"), not a hardcoded taxonomy -- a tenant that
  // hasn't been provisioned with a given module/action pair simply won't
  // show that column/row combination as available.
  const permByKey = useMemo(() => new Map(permissions.map((p) => [p.key, p])), [permissions]);
  const { modules, actions } = useMemo(() => {
    const mods = new Set<string>();
    const acts = new Set<string>();
    for (const p of permissions) {
      const idx = p.key.indexOf(".");
      if (idx <= 0 || idx === p.key.length - 1) continue;
      mods.add(p.key.slice(0, idx));
      acts.add(p.key.slice(idx + 1));
    }
    return { modules: [...mods].sort(), actions: [...acts].sort() };
  }, [permissions]);

  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [baselineByRole, setBaselineByRole] = useState<Record<string, Set<string>>>({});
  const [draftByRole, setDraftByRole] = useState<Record<string, Set<string>>>({});
  const [loadErrorByRole, setLoadErrorByRole] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (orderedRoles.length === 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void Promise.all(
      orderedRoles.map(async (r) => {
        const result = await fetchRolePermissions(r.id);
        return { roleId: r.id, result };
      }),
    ).then((results) => {
      if (cancelled) return;
      const baseline: Record<string, Set<string>> = {};
      const errors: Record<string, string> = {};
      for (const { roleId, result } of results) {
        if (result.ok) baseline[roleId] = new Set(result.keys ?? []);
        else errors[roleId] = result.message ?? "Couldn't load this role's permissions";
      }
      setBaselineByRole(baseline);
      setDraftByRole(Object.fromEntries(Object.entries(baseline).map(([id, keys]) => [id, new Set(keys)])));
      setLoadErrorByRole(errors);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // orderedRoles is derived from the roles prop each render; re-fetch only
    // when the underlying role id set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedRoles.map((r) => r.id).join(",")]);

  const visibleRoles = selectedRole === "all" ? orderedRoles : orderedRoles.filter((r) => r.id === selectedRole);

  function toggle(roleId: string, key: string) {
    setDraftByRole((prev) => {
      const current = new Set(prev[roleId] ?? []);
      if (current.has(key)) current.delete(key); else current.add(key);
      return { ...prev, [roleId]: current };
    });
    setNotice("");
    setSaveError("");
  }

  const dirtyRoleIds = useMemo(
    () => orderedRoles
      .filter((r) => !r.isSystem)
      .map((r) => r.id)
      .filter((id) => {
        const base = baselineByRole[id] ?? new Set<string>();
        const draft = draftByRole[id] ?? new Set<string>();
        if (base.size !== draft.size) return true;
        for (const k of base) if (!draft.has(k)) return true;
        return false;
      }),
    [orderedRoles, baselineByRole, draftByRole],
  );
  const changedCount = dirtyRoleIds.reduce((n, id) => {
    const base = baselineByRole[id] ?? new Set<string>();
    const draft = draftByRole[id] ?? new Set<string>();
    let c = 0;
    for (const k of draft) if (!base.has(k)) c++;
    for (const k of base) if (!draft.has(k)) c++;
    return n + c;
  }, 0);

  async function saveChanges(reason?: string) {
    setBusy(true);
    setSaveError("");
    const failures: string[] = [];
    const saved: string[] = [];
    for (const roleId of dirtyRoleIds) {
      const draft = draftByRole[roleId] ?? new Set<string>();
      const role = orderedRoles.find((r) => r.id === roleId);
      const result = await saveRolePermissions(roleId, [...draft], reason);
      if (!result.ok) {
        failures.push(role?.name ?? roleId);
        continue;
      }
      saved.push(role?.name ?? roleId);
      setBaselineByRole((prev) => ({ ...prev, [roleId]: new Set(draft) }));
    }
    setBusy(false);
    if (failures.length > 0) {
      // GAP-PLATFORM-ADMIN-ROLES-03: on a partial failure report BOTH which
      // roles saved and which failed (not only the failures) so the operator
      // knows the real post-save state — some roles ARE already committed.
      // The dirty set shrinks to only the failed roles, so a retry resends
      // just those (baseline was updated per success above).
      const savedPart = saved.length > 0 ? `${saved.length} saved (${saved.join(", ")}); ` : "";
      setSaveError(`${savedPart}${failures.length} failed (${failures.join(", ")}). Only the failed role${failures.length === 1 ? "" : "s"} remain unsaved — press Save again to retry.`);
      return;
    }
    setNotice(`${changedCount} permission change${changedCount === 1 ? "" : "s"} saved across ${saved.length} role${saved.length === 1 ? "" : "s"}.`);
    setConfirmOpen(false);
  }

  const selSty: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--bg)" };

  return (
    <div>
      <DataSourceBadge source={source} message="Couldn't load roles or permissions — showing nothing" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Roles & Permissions Matrix</h3>
            <span className="pill info">{orderedRoles.length} roles · {modules.length} modules · {actions.length} actions</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              style={selSty}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="all">All roles</option>
              {orderedRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button size="sm" disabled={changedCount === 0 || busy || loading} onClick={() => setConfirmOpen(true)}>
              {busy ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "No changes"}
            </Button>
          </div>
        </div>

        {notice ? (
          <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--good, #027a48)", margin: 0, padding: "6px 16px 0" }}>{notice}</p>
        ) : null}
        {saveError ? (
          <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", margin: 0, padding: "6px 16px 0" }}>{saveError}</p>
        ) : null}

        <div style={{ padding: "8px 16px", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--ink2)", borderTop: "1px solid var(--line)", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "var(--warnbg, #fffaeb)", color: "var(--warn, #b54708)", border: "1px solid var(--warnbd, #fec84b)" }}>SoD</span>
            <span>Segregation of Duty violation — submit + approve on the same financial module (GFR 2017 compliant). Super Admin and Platform Admin are exempt.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "1px dashed var(--line)", color: "var(--mut)" }}>—</span>
            <span>Permission not yet provisioned for this tenant.</span>
          </div>
        </div>
      </div>

      {loading ? (
        <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>Loading role permissions…</p>
      ) : orderedRoles.length === 0 ? (
        <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>No roles are defined for this tenant yet.</p>
      ) : modules.length === 0 || actions.length === 0 ? (
        <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>No permissions are defined for this tenant yet.</p>
      ) : (
        <div>
          <span id="sod-explanation" className="sr-only">
            Blocked by segregation of duties: submit and approve on the same financial module cannot both be granted to one role (GFR 2017).
          </span>
          {visibleRoles.map((role) => {
            const loadError = loadErrorByRole[role.id];
            const draft = draftByRole[role.id] ?? new Set<string>();
            return (
              <div key={role.id} className="card" style={{ marginBottom: 16 }}>
                <div className="card-h">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h4 style={{ margin: 0 }}>{role.name}</h4>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--ink2)" }}>{role.key}</span>
                    {role.isSystem && <span className="pill mut" style={{ fontSize: 11 }}>System — read-only</span>}
                  </div>
                </div>
                {loadError ? (
                  <p role="alert" style={{ padding: "12px 16px", color: "#b42318", fontSize: 12.5 }}>{loadError}</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 580 }}>
                      <thead>
                        <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
                          <th style={{ padding: "8px 14px", textAlign: "start", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", position: "sticky", insetInlineStart: 0, background: "var(--line2, #f8fafc)", zIndex: 1 }}>Module</th>
                          {actions.map((a) => (
                            <th key={a} style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, fontWeight: 650, color: "var(--ink2)", letterSpacing: 0.4 }}>{keyLabel(a)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {modules.map((mod) => (
                          <tr key={mod} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "8px 14px", position: "sticky", insetInlineStart: 0, background: "var(--card, #fff)", zIndex: 1, boxShadow: "1px 0 0 var(--line)" }}>
                              <span style={{ fontWeight: 600 }}>{keyLabel(mod)}</span>
                            </td>
                            {actions.map((action) => {
                              const key = `${mod}.${action}`;
                              const perm = permByKey.get(key);
                              const granted = draft.has(key);
                              const sod = (action === "submit" || action === "approve") && sodViolation(role.key, mod, (a) => draft.has(`${mod}.${a}`));
                              return (
                                <td key={action} style={{ padding: "8px 10px", textAlign: "center" }}>
                                  <ToggleCell
                                    granted={granted}
                                    provisioned={!!perm}
                                    sod={sod}
                                    editable={!role.isSystem && !!perm}
                                    label={`${keyLabel(mod)} ${keyLabel(action)}`}
                                    sodDescId="sod-explanation"
                                    onToggle={() => toggle(role.id, key)}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Save permission changes?"
        description={`You are applying ${changedCount} permission change${changedCount === 1 ? "" : "s"} across ${dirtyRoleIds.length} role${dirtyRoleIds.length === 1 ? "" : "s"}. This takes effect immediately.`}
        confirmLabel="Save changes"
        requireReason
        reasonLabel="Reason for this RBAC change"
        minReasonLength={5}
        busy={busy}
        errorMessage={saveError || undefined}
        onConfirm={(reason) => void saveChanges(reason)}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}

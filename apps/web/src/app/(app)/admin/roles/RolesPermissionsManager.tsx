"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, ConfirmDialog, PageHeader, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminRoleSummary, AdminPermissionSummary } from "@/app/_data/loaders";
import { toHumanError, type MessageKind } from "@/lib/messages";

/**
 * Plain-language failure message for a failed role-permissions read/write.
 * These are plain async API helpers, not components, so they can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function rolePermissionsError(kind: MessageKind): string {
  const human = toHumanError(kind, { area: "role permissions" });
  return `${human.what} ${human.next}`;
}

async function fetchRolePermissions(roleId: string): Promise<{ ok: boolean; keys?: string[]; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}`);
    if (!res.ok) return { ok: false, message: rolePermissionsError("load") };
    const body = await res.json().catch(() => undefined);
    const permissions = (body as { permissions?: unknown })?.permissions;
    return { ok: true, keys: Array.isArray(permissions) ? permissions.map(String) : [] };
  } catch {
    return { ok: false, message: rolePermissionsError("load") };
  }
}

async function saveRolePermissions(roleId: string, permissionKeys: string[]): Promise<{ ok: boolean; partial?: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}/permissions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionKeys }),
    });
    if (!res.ok) return { ok: false, message: rolePermissionsError("save") };
    // admin-service answers 207 + a `failed` list when only some of the
    // grants/revokes applied. That is NOT "Saved." -- the role's real
    // permission set now differs from what the admin ticked.
    const body = (await res.json().catch(() => undefined)) as { status?: string; failed?: unknown[] } | undefined;
    if (res.status === 207 || body?.status === "partial" || (Array.isArray(body?.failed) && body!.failed!.length > 0)) {
      return { ok: false, partial: true, message: "Some permission changes could not be applied. The list below shows what is actually granted now — review it and try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: rolePermissionsError("save") };
  }
}

export function RolesPermissionsManager({
  roles,
  permissions,
  source,
}: {
  roles: AdminRoleSummary[];
  permissions: AdminPermissionSummary[];
  source: "api" | "error";
}) {
  const assignableRoles = useMemo(() => roles.filter((r) => !r.isSystem), [roles]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(assignableRoles[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // GAP-ADMIN-ROLES-02: Save shows the exact grant/revoke diff and asks first.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  useEffect(() => {
    if (!selectedRoleId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveState("idle");
    void fetchRolePermissions(selectedRoleId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message ?? "Couldn't load this role's permissions");
        setBaseline(new Set());
        setSelected(new Set());
      } else {
        const keys = new Set(result.keys ?? []);
        setBaseline(keys);
        setSelected(new Set(keys));
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedRoleId]);

  const changedCount = useMemo(() => {
    let n = 0;
    for (const k of selected) if (!baseline.has(k)) n++;
    for (const k of baseline) if (!selected.has(k)) n++;
    return n;
  }, [selected, baseline]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!selectedRoleId) return;
    setSaveState("saving");
    setSaveError(null);
    const result = await saveRolePermissions(selectedRoleId, [...selected]);
    setConfirmOpen(false);
    if (!result.ok) {
      setSaveState("error");
      setSaveError(result.message ?? null);
      if (result.partial) {
        // Re-read the role so the checkboxes show the real resulting set.
        const fresh = await fetchRolePermissions(selectedRoleId);
        if (fresh.ok) {
          const keys = new Set(fresh.keys ?? []);
          setBaseline(keys);
          setSelected(new Set(keys));
        }
      }
      return;
    }
    setBaseline(new Set(selected));
    setSaveState("saved");
  }

  const totalPermissionsGranted = selected.size;
  const grantedKeys = [...selected].filter((k) => !baseline.has(k));
  const revokedKeys = [...baseline].filter((k) => !selected.has(k));
  const permName = (key: string) => permissions.find((p) => p.key === key)?.name ?? key;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Role Permissions"
        subtitle="Select a role to view and edit its granted permissions."
        back="/admin"
      />
      <DataSourceBadge source={source} message="Couldn't load roles or permissions — showing nothing" />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Assignable roles" value={assignableRoles.length} />
        <StatCard icon="🛡️" iconBg="#eff6ff" label="Total permissions" value={permissions.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Granted to selected role" value={selectedRole && !loading && !loadError ? totalPermissionsGranted : null} />
        <StatCard icon="🔒" iconBg="#fffbeb" label="System roles (read-only)" value={roles.filter((r) => r.isSystem).length} />
      </div>

      <div className="card">
        <div className="card-h" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label htmlFor="role-select" style={{ fontWeight: 600, fontSize: 13.5 }}>Role:</label>
            <select
              id="role-select"
              className="input"
              value={selectedRoleId ?? ""}
              onChange={(e) => setSelectedRoleId(e.target.value || null)}
              style={{ minWidth: 220 }}
            >
              {roles.length === 0 && <option value="">No roles available</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.isSystem ? " (system — read-only)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {saveState === "saved" && <span role="status" style={{ fontSize: 12, color: "#027a48" }}>Saved.</span>}
            {saveState === "error" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{saveError}</span>}
            <Button
              type="button"
              size="sm"
              disabled={!selectedRole || selectedRole.isSystem || changedCount === 0 || loading}
              onClick={() => { setSaveState("idle"); setConfirmOpen(true); }}
              loading={saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Save changes"}
            </Button>
          </div>
        </div>

        {!selectedRole ? (
          <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>No role selected.</p>
        ) : selectedRole.isSystem ? (
          <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>
            <strong>{selectedRole.name}</strong> is a system role — its permissions are fixed and cannot be edited here.
          </p>
        ) : loading ? (
          <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>Loading current permissions…</p>
        ) : loadError ? (
          <p role="alert" style={{ padding: 24, color: "#b42318", fontSize: 13 }}>{loadError}</p>
        ) : permissions.length === 0 ? (
          <p style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>No permissions are defined for this tenant yet.</p>
        ) : (
          <div style={{ padding: "12px 16px 20px", display: "grid", gap: 8 }}>
            {permissions.map((perm) => {
              const checked = selected.has(perm.key);
              return (
                <label
                  key={perm.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
                    padding: "9px 12px", borderRadius: 8,
                    border: `1.5px solid ${checked ? "#4f46e5" : "var(--line)"}`,
                    background: checked ? "#eef2ff" : "transparent",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(perm.key)} style={{ width: 15, height: 15, cursor: "pointer", marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{perm.name} <code style={{ fontSize: 11, color: "var(--mut)", fontWeight: 400 }}>{perm.key}</code></div>
                    {perm.description && <div style={{ fontSize: 11.5, color: "var(--mut)", marginTop: 1 }}>{perm.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        danger={revokedKeys.length > 0}
        title={`Change permissions for ${selectedRole?.name ?? "this role"}?`}
        description={
          <div>
            {grantedKeys.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong>Grant ({grantedKeys.length})</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{grantedKeys.map((k) => <li key={k}>{permName(k)} <code>{k}</code></li>)}</ul>
              </div>
            )}
            {revokedKeys.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong>Revoke ({revokedKeys.length})</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{revokedKeys.map((k) => <li key={k}>{permName(k)} <code>{k}</code></li>)}</ul>
              </div>
            )}
            <p style={{ margin: 0 }}>This changes access for everyone holding this role and is recorded in the audit trail.</p>
          </div>
        }
        confirmLabel="Apply changes"
        busy={saveState === "saving"}
        onConfirm={() => void save()}
        onCancel={() => { if (saveState !== "saving") setConfirmOpen(false); }}
      />
    </div>
  );
}

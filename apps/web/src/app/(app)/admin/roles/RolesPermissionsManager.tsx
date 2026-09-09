"use client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminRoleSummary, AdminPermissionSummary } from "@/app/_data/loaders";

async function fetchRolePermissions(roleId: string): Promise<{ ok: boolean; keys?: string[]; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}`);
    const body = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, message: (body as { message?: string } | undefined)?.message ?? `HTTP ${res.status}` };
    const permissions = (body as { permissions?: unknown })?.permissions;
    return { ok: true, keys: Array.isArray(permissions) ? permissions.map(String) : [] };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

async function saveRolePermissions(roleId: string, permissionKeys: string[]): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/roles/${roleId}/permissions`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionKeys }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: (body as { message?: string }).message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
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
    if (!result.ok) {
      setSaveState("error");
      setSaveError(result.message ?? "Save failed");
      return;
    }
    setBaseline(new Set(selected));
    setSaveState("saved");
  }

  const totalPermissionsGranted = selected.size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Role Permissions"
        subtitle="Select a role to view and edit its granted permissions."
        back="/admin"
      />
      <DataSourceBadge source={source} message="Couldn't load roles or permissions — showing nothing" />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Assignable roles" value={assignableRoles.length} />
        <StatCard icon="🛡️" iconBg="#eff6ff" label="Total permissions" value={permissions.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Granted to selected role" value={selectedRole ? totalPermissionsGranted : 0} />
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
            {saveState === "error" && <span role="alert" style={{ fontSize: 12, color: "#b42318" }}>{saveError ?? "Save failed."}</span>}
            <button
              type="button"
              className="btn primary sm"
              disabled={!selectedRole || selectedRole.isSystem || changedCount === 0 || saveState === "saving" || loading}
              onClick={() => void save()}
              aria-busy={saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Save changes"}
            </button>
          </div>
        </div>

        {!selectedRole ? (
          <p style={{ padding: 24, color: "var(--ink3)", fontSize: 13 }}>No role selected.</p>
        ) : selectedRole.isSystem ? (
          <p style={{ padding: 24, color: "var(--ink3)", fontSize: 13 }}>
            <strong>{selectedRole.name}</strong> is a system role — its permissions are fixed and cannot be edited here.
          </p>
        ) : loading ? (
          <p style={{ padding: 24, color: "var(--ink3)", fontSize: 13 }}>Loading current permissions…</p>
        ) : loadError ? (
          <p role="alert" style={{ padding: 24, color: "#b42318", fontSize: 13 }}>{loadError}</p>
        ) : permissions.length === 0 ? (
          <p style={{ padding: 24, color: "var(--ink3)", fontSize: 13 }}>No permissions are defined for this tenant yet.</p>
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
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{perm.name} <code style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 400 }}>{perm.key}</code></div>
                    {perm.description && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>{perm.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/app/_components/ds";
import type { AdminUserSummary, AdminRoleSummary } from "@/app/_data/loaders";

type Row = AdminUserSummary & Record<string, unknown>;

const STATUS_FILTERS = ["All", "Active", "Suspended", "Locked", "Deactivated"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function StatusChip({ status }: { status: AdminUserSummary["status"] }) {
  if (status === "active") return <span className="pill good">Active</span>;
  if (status === "suspended") return <span className="pill bad">Suspended</span>;
  if (status === "locked") return <span className="pill bad">Locked</span>;
  return <span className="pill mut">Deactivated</span>;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/users${path}`, {
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

function EditRolesSheet({
  user,
  roles,
  onClose,
}: {
  user: AdminUserSummary | null;
  roles: AdminRoleSummary[];
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.id;

  // Fetch this user's REAL effective roles when the sheet opens — the
  // directory list intentionally does not carry a roles column (identity-
  // service's user-list endpoint doesn't return roles; inventing them here
  // would just reintroduce fabricated data one level down).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Deliberately /admin/user-roles/, not /admin/users/:id/roles — the
    // gateway's admin-users entry shadows the whole /v1/admin/users/* prefix
    // straight to identity-service, which has no matching route there (see
    // gap/routes.ts's comment on the admin-service handler for this).
    fetch(`/api/proxy/v1/admin/user-roles/${userId}`)
      .then((res) => res.json())
      .then((body: { data?: Array<{ key: string }> }) => {
        if (cancelled) return;
        const keys = new Set((body.data ?? []).map((r) => r.key));
        setCurrent(keys);
        setSelected(new Set(keys));
      })
      .catch(() => { if (!cancelled) setError("Couldn't load this user's current roles."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (!user) return null;
  const safeUser = user;

  function toggleRole(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/v1/admin/user-roles/${safeUser.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleKeys: [...selected] }),
    });
    const result = res.ok
      ? { ok: true as const }
      : { ok: false as const, message: (await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}` };
    setBusy(false);
    if (!result.ok) { setError(result.message ?? "Save failed"); return; }
    onClose();
  }

  const changed = current.size !== selected.size || [...current].some((k) => !selected.has(k));

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" style={{ position: "fixed", inset: 0, display: "flex", zIndex: 50 }}>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.35)" }} onClick={onClose} aria-hidden="true" />
      <div style={{ width: 380, background: "var(--surface)", height: "100%", padding: 28, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 id="sheet-title" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Edit Roles</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink3)" }}>{user.name} · {user.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink3)", lineHeight: 1 }}>×</button>
        </div>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "#b42318" }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--ink3)", fontSize: 13 }}>Loading current roles…</p>
        ) : roles.length === 0 ? (
          <p style={{ color: "var(--ink3)", fontSize: 13 }}>No roles are defined for this tenant yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {roles.map((r) => {
              const active = selected.has(r.key);
              return (
                <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${active ? "#4f46e5" : "var(--line)"}`, background: active ? "#eef2ff" : "transparent" }}>
                  <input type="checkbox" checked={active} onChange={() => toggleRole(r.key)} style={{ width: 15, height: 15, cursor: "pointer" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>{r.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
          <button type="button" className="btn primary sm" disabled={busy || loading || !changed} onClick={() => void save()} aria-busy={busy}>
            {busy ? "Saving…" : "Save roles"}
          </button>
          <button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function AdminUsersManager({
  initialUsers,
  roles,
  source,
}: {
  initialUsers: AdminUserSummary[];
  roles: AdminRoleSummary[];
  source: "api" | "error";
}) {
  const [users, setUsers] = useState<AdminUserSummary[]>(initialUsers);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [editUser, setEditUser] = useState<AdminUserSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo<Row[]>(() => {
    const base = filter === "All" ? users : users.filter((u) => u.status === filter.toLowerCase());
    return base as Row[];
  }, [users, filter]);

  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const locked = users.filter((u) => u.status === "locked" || u.status === "deactivated").length;

  async function toggleStatus(user: AdminUserSummary) {
    const newStatus = user.status === "active" ? "suspended" : "active";
    setBusyId(user.id);
    setError(null);
    const result = await callApi(`/${user.id}/status`, "PATCH", { status: newStatus });
    if (!result.ok) {
      setError(result.message ?? "Status update failed");
    } else {
      // Reflect the confirmed state from the server response rather than
      // assuming the request succeeded exactly as sent.
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u)));
    }
    setBusyId(null);
  }

  function downloadCsv() {
    const header = "Name,Email,Employee Code,Status,MFA Enabled";
    const rows = filtered.map((u) => [u.name, u.email, u.empCode ?? "", u.status, u.mfaEnabled ? "yes" : "no"].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div className="card">
        <div className="card-h">
          <h3>User directory</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="tabs" role="tablist" aria-label="Filter users by status">
              {STATUS_FILTERS.map((f) => (
                <span
                  key={f}
                  className={filter === f ? "on" : undefined}
                  role="tab"
                  aria-selected={filter === f}
                  tabIndex={0}
                  onClick={() => setFilter(f)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFilter(f); } }}
                >
                  {f}
                </span>
              ))}
            </div>
            <button type="button" className="btn ghost sm" onClick={downloadCsv}>Export CSV</button>
          </div>
        </div>
        <DataTable<Row>
          columns={[
            {
              key: "name",
              label: "User",
              render: (u) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e0e7ff", color: "#4f46e5", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-hidden="true">
                    {String(u.name || u.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 550 }}>{String(u.name) || "—"}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)" }}>{String(u.email)}</div>
                  </div>
                </div>
              ),
            },
            { key: "empCode", label: "Employee Code", render: (u) => <span style={{ fontSize: 13 }}>{u.empCode ? String(u.empCode) : "—"}</span> },
            {
              key: "mfaEnabled",
              label: "MFA",
              render: (u) => (u.mfaEnabled ? <span className="pill good">Enabled</span> : <span className="pill mut">Disabled</span>),
            },
            { key: "status", label: "Status", render: (u) => <StatusChip status={u.status as AdminUserSummary["status"]} /> },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (u) => (
                <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                  <button type="button" className="btn ghost sm" onClick={() => setEditUser(u as AdminUserSummary)} style={{ fontSize: 11.5 }}>
                    Edit Roles
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busyId === u.id || u.status === "locked" || u.status === "deactivated"}
                    onClick={() => void toggleStatus(u as AdminUserSummary)}
                    style={{ fontSize: 11.5, color: u.status === "active" ? "#b42318" : "#027a48" }}
                  >
                    {busyId === u.id ? "…" : u.status === "active" ? "Suspend" : "Activate"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled
                    title="Password reset is managed via Keycloak — use the Keycloak Admin console"
                    aria-disabled="true"
                    style={{ fontSize: 11.5, opacity: 0.45, cursor: "not-allowed" }}
                  >
                    Reset Password
                  </button>
                </div>
              ),
            },
          ]}
          rows={filtered}
          sortable
          filterable
          filterPlaceholder="Search name or email…"
          pageSize={25}
          emptyIcon="👥"
          emptyTitle={source === "error" ? "Couldn't load users" : "No users match"}
          emptyMessage={source === "error" ? "The user directory couldn't be reached — showing nothing." : "Try a different filter or clear the search."}
        />
      </div>
      <EditRolesSheet user={editUser} roles={roles} onClose={() => setEditUser(null)} />
    </>
  );
}

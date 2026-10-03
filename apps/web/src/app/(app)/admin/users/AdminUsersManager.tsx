"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, DataTable, StatCard, Tabs } from "@/app/_components/ds";
import type { AdminUserSummary, AdminRoleSummary } from "@/app/_data/loaders";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { toCsv } from "@/lib/csv";
import { summarizeUsers } from "./usersSummary";

type Row = AdminUserSummary & Record<string, unknown>;

/**
 * Role keys that confer platform-wide authority. identity-service only lets a
 * caller with platform_admin/super_admin authority confer these (its
 * anti-self-escalation guard); a tenant admin must never be offered them as a
 * tickable option (GAP-ADMIN-USERS-02).
 */
const PLATFORM_AUTHORITY_ROLE_KEYS = ["super_admin", "platform_admin"];

const STATUS_FILTERS = ["All", "Active", "Suspended", "Locked", "Deactivated"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function StatusChip({ status }: { status: AdminUserSummary["status"] }) {
  if (status === "active") return <span className="pill good">Active</span>;
  if (status === "suspended") return <span className="pill bad">Suspended</span>;
  if (status === "locked") return <span className="pill bad">Locked</span>;
  return <span className="pill mut">Deactivated</span>;
}

/**
 * Plain-language failure message for a failed user-status call. This is a
 * plain async API helper, not a component, so it can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function adminUserError(): string {
  const human = toHumanError("save", { area: "user" });
  return `${human.what} ${human.next}`;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/users${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, message: adminUserError() };
    return { ok: true, json };
  } catch {
    return { ok: false, message: adminUserError() };
  }
}

async function callExportAudit(info: { rowCount: number; filter: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/proxy/v1/admin/user-exports/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowCount: info.rowCount, filter: info.filter }),
    });
    if (!res.ok) return { ok: false, message: "Couldn't record this export in the audit trail, so no file was created. Try again." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't record this export in the audit trail, so no file was created. Try again." };
  }
}

function EditRolesSheet({
  user,
  roles,
  canAssignPlatformRoles,
  onClose,
}: {
  user: AdminUserSummary | null;
  roles: AdminRoleSummary[];
  canAssignPlatformRoles: boolean;
  onClose: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef(false);
  confirmRef.current = confirmOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("user roles");

  const userId = user?.id;
  const panelRef = useRef<HTMLDivElement>(null);
  // GAP-ADMIN-USERS-07: Esc closes (unless the confirm dialog is on top, which
  // handles its own Esc), Tab stays inside the sheet, focus moves in on open and
  // returns to the control that opened it.
  useEffect(() => {
    if (!userId) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
    (focusables()[0] ?? panel)?.focus();
    function onKey(e: KeyboardEvent) {
      if (confirmRef.current) return;
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel?.contains(active))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus(); };
  }, [userId]);

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
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/admin/user-roles/${safeUser.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleKeys: [...selected] }),
      });
      setBusy(false);
      setConfirmOpen(false);
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      onClose();
    } catch (caught) {
      setBusy(false);
      setConfirmOpen(false);
      setError(formError.fromException("save", caught).message);
    }
  }

  const changed = current.size !== selected.size || [...current].some((k) => !selected.has(k));
  const granted = [...selected].filter((k) => !current.has(k));
  const revoked = [...current].filter((k) => !selected.has(k));
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" style={{ position: "fixed", inset: 0, display: "flex", zIndex: 50 }}>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.35)" }} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} tabIndex={-1} style={{ width: "min(380px, 100vw)", background: "var(--panel)", height: "100%", padding: 28, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 id="sheet-title" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Edit Roles</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>{user.name} · {user.email}</p>
          </div>
          {/* Icon-only close glyph with no .btn/.iconbtn convention applied
              today -- out of scope for the shared Button (text-button-shaped,
              not icon-only per its own doc comment); left as-is. */}
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--mut)", lineHeight: 1 }}>×</button>
        </div>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "#b42318" }}>{error}</p>}
        {loading ? (
          <p style={{ color: "var(--mut)", fontSize: 13 }}>Loading current roles…</p>
        ) : roles.length === 0 ? (
          <p style={{ color: "var(--mut)", fontSize: 13 }}>No roles are defined for this tenant yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {roles.map((r) => {
              const active = selected.has(r.key);
              // GAP-ADMIN-USERS-02: platform-authority roles are not offered to
              // a tenant admin (shown read-only so a held one is never dropped
              // by the full-set save).
              const locked = !canAssignPlatformRoles && PLATFORM_AUTHORITY_ROLE_KEYS.includes(r.key);
              return (
                <label key={r.id} title={locked ? "Platform roles can only be assigned by platform staff" : undefined} style={{ display: "flex", alignItems: "center", gap: 12, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.6 : 1, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${active ? "#4f46e5" : "var(--line)"}`, background: active ? "#eef2ff" : "transparent" }}>
                  <input type="checkbox" checked={active} disabled={locked} onChange={() => toggleRole(r.key)} style={{ width: 15, height: 15, cursor: locked ? "not-allowed" : "pointer" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 11.5, color: "var(--mut)" }}>{r.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
          <Button type="button" size="sm" disabled={busy || loading || !changed} onClick={() => setConfirmOpen(true)} loading={busy}>
            {busy ? "Saving…" : "Save roles"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        danger={revoked.length > 0}
        title={`Change roles for ${safeUser.name || safeUser.email}?`}
        description={
          <div>
            {granted.length > 0 && <p style={{ margin: "0 0 6px" }}>Grant: <strong>{granted.map(roleName).join(", ")}</strong></p>}
            {revoked.length > 0 && <p style={{ margin: "0 0 6px" }}>Revoke: <strong>{revoked.map(roleName).join(", ")}</strong></p>}
            <p style={{ margin: 0 }}>This changes what this person can access and is recorded in the audit trail.</p>
          </div>
        }
        confirmLabel="Save roles"
        busy={busy}
        onConfirm={() => void save()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}

export function AdminUsersManager({
  initialUsers,
  roles,
  source,
  currentUserId = null,
  canAssignPlatformRoles = false,
  truncatedAt = null,
}: {
  initialUsers: AdminUserSummary[];
  roles: AdminRoleSummary[];
  source: "api" | "error";
  /** The signed-in user's id (JWT sub): their own row can't be suspended from here. */
  currentUserId?: string | null;
  /** True only for platform_admin/super_admin sessions. */
  canAssignPlatformRoles?: boolean;
  /** Set to the list cap when the directory may hold more users than were loaded. */
  truncatedAt?: number | null;
}) {
  const [confirm, setConfirm] = useState<{ user: AdminUserSummary; next: "suspended" | "active" } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const [users, setUsers] = useState<AdminUserSummary[]>(initialUsers);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [editUser, setEditUser] = useState<AdminUserSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>(undefined);

  // GAP-ADMIN-USERS-05: tiles derive from the live `users` state, so a
  // suspend/activate moves the counts immediately.
  const summary = useMemo(() => summarizeUsers(users), [users]);

  const filtered = useMemo<Row[]>(() => {
    const base = filter === "All" ? users : users.filter((u) => u.status === filter.toLowerCase());
    return base as Row[];
  }, [users, filter]);

  function askToggleStatus(user: AdminUserSummary) {
    // GAP-ADMIN-USERS-01: never act on your own account from this screen.
    if (user.id === currentUserId) return;
    setConfirmError(undefined);
    setConfirm({ user, next: user.status === "active" ? "suspended" : "active" });
  }

  async function confirmToggleStatus(reason?: string) {
    if (!confirm) return;
    const { user, next } = confirm;
    setConfirmBusy(true);
    setBusyId(user.id);
    setError(null);
    setConfirmError(undefined);
    const result = await callApi(`/${user.id}/status`, "PATCH", { status: next, ...(reason ? { reason } : {}) });
    setBusyId(null);
    setConfirmBusy(false);
    if (!result.ok) {
      setConfirmError(result.message ?? adminUserError());
      return;
    }
    // Reflect the confirmed state from the server response rather than
    // assuming the request succeeded exactly as sent.
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: next } : u)));
    setConfirm(null);
  }

  // GAP-ADMIN-USERS-06: the file carries unmasked personal data (name, email,
  // employee code), so the export is confirmed, recorded in the audit trail
  // BEFORE the file is built (fail-closed: no audit record, no file), and the
  // CSV is quoted + formula-neutralised via toCsv.
  async function confirmExport() {
    setExportBusy(true);
    setExportError(undefined);
    const audit = await callExportAudit({ rowCount: filtered.length, filter });
    setExportBusy(false);
    if (!audit.ok) {
      setExportError(audit.message);
      return;
    }
    const csv = toCsv([
      ["Name", "Email", "Employee Code", "Status", "MFA Enabled"],
      ...filtered.map((u) => [u.name, u.email, u.empCode ?? "", u.status, u.mfaEnabled ? "yes" : "no"]),
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users-export.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }

  return (
    <>
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {truncatedAt !== null && (
        <div role="status" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          Showing the first {truncatedAt} users only. There may be more people in this office than are listed here, so a missing user is not proof they do not exist.
        </div>
      )}
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total users" value={truncatedAt !== null ? `${summary.total}+` : summary.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={summary.active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={summary.suspended} />
        <StatCard icon="🔒" iconBg="#fffbeb" label="Locked / deactivated" value={summary.other} />
      </div>
      <div className="card">
        <div className="card-h">
          <h3>User directory</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs tabs={[...STATUS_FILTERS]} active={filter} onChange={(t) => setFilter(t as StatusFilter)} />
            <Button type="button" variant="ghost" size="sm" onClick={() => { setExportError(undefined); setExportOpen(true); }}>Export CSV</Button>
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
                    <div style={{ fontSize: 12, color: "var(--mut)" }}>{String(u.email)}</div>
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditUser(u as AdminUserSummary)} style={{ fontSize: 11.5 }}>
                    Edit Roles
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyId === u.id || u.status === "locked" || u.status === "deactivated" || (u.status === "active" && u.id === currentUserId)}
                    title={u.id === currentUserId ? "You cannot suspend your own account" : undefined}
                    onClick={() => askToggleStatus(u as AdminUserSummary)}
                    style={{ fontSize: 11.5, color: u.status === "active" ? "#b42318" : "#027a48" }}
                  >
                    {busyId === u.id ? "…" : u.status === "active" ? "Suspend" : "Activate"}
                  </Button>
                  <span style={{ fontSize: 11.5, color: "var(--mut)", alignSelf: "center", whiteSpace: "normal", maxWidth: 190 }}>
                    Password reset is managed in the Keycloak Admin console.
                  </span>
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
      <ConfirmDialog
        open={exportOpen}
        title="Export user list?"
        description="The file contains personal data (names, emails, employee codes) for the users currently shown. Handle it under your data-protection policy. This export is recorded in the audit trail."
        confirmLabel="Export CSV"
        busy={exportBusy}
        errorMessage={exportError}
        onConfirm={() => void confirmExport()}
        onCancel={() => { if (!exportBusy) setExportOpen(false); }}
      />
      <EditRolesSheet user={editUser} roles={roles} canAssignPlatformRoles={canAssignPlatformRoles} onClose={() => setEditUser(null)} />
      <ConfirmDialog
        open={confirm !== null}
        danger={confirm?.next === "suspended"}
        requireReason={confirm?.next === "suspended"}
        optionalReason={confirm?.next === "active"}
        minReasonLength={3}
        maxReasonLength={500}
        title={confirm ? `${confirm.next === "suspended" ? "Suspend" : "Activate"} ${confirm.user.name || confirm.user.email}?` : ""}
        description={confirm?.next === "suspended"
          ? "They will be unable to sign in until the account is activated again. The reason is recorded in the audit trail."
          : "They will be able to sign in again."}
        confirmLabel={confirm?.next === "suspended" ? "Suspend user" : "Activate user"}
        busy={confirmBusy}
        errorMessage={confirmError}
        onConfirm={(reason) => void confirmToggleStatus(reason)}
        onCancel={() => { if (!confirmBusy) { setConfirm(null); setConfirmError(undefined); } }}
      />
    </>
  );
}

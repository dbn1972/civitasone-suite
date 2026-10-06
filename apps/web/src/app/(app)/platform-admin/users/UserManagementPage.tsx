"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { errorMessageFromResponse } from "@/lib/api/browserClient";
import { maskEmail } from "@/app/_components/ds/Masked";

/* ─── Types ──────────────────────────────────────────────────────────── */
type PlatformUser = {
  id: string;
  name?: string | null;
  email: string;
  roles: string[];
  status: string;
  lastLoginAt?: string | null;
  mfaEnabled: boolean;
  department?: string | null;
  tenantId?: string | null;
} & Record<string, unknown>;

/**
 * Roles that may see unmasked PII (email, department) and export the directory
 * (GAP-PLATFORM-ADMIN-USERS-01). Kept as a plain literal here — this is a
 * "use client" component and must not import lib/auth/roleGuard (it pulls in
 * next/headers). The server /platform-admin layout is the real access gate;
 * this only decides what an admitted viewer sees / may egress.
 */
const FULL_ACCESS_ROLES = ["platform_admin", "super_admin"];
const SUPER_ADMIN_ROLE = "super_admin";

// Mirrors admin-service USER_EXPORT_MAX_ROWS: the browser can only export rows it loaded.
const EXPORT_MAX_ROWS = 200;

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  super_admin:    { bg: "#fef3f2", color: "#b42318" },
  platform_admin: { bg: "#eff6ff", color: "#1e40af" },
  tenant_admin:   { bg: "#ecfdf3", color: "#027a48" },
  hr_admin:       { bg: "#f5f3ff", color: "#5b21b6" },
  payroll_admin:  { bg: "#fffaeb", color: "#b54708" },
  finance_admin:  { bg: "#f0fdf4", color: "#166534" },
  audit_admin:    { bg: "#fff7ed", color: "#9a3412" },
  dept_head:      { bg: "#f0f9ff", color: "#075985" },
  hr_staff:       { bg: "#fdf2f8", color: "#86198f" },
};

function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] ?? { bg: "var(--line2)", color: "var(--ink2)" };
  return (
    <span style={{ ...colors, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, marginInlineEnd: 4, display: "inline-block" }}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(iso?: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * GAP-PLATFORM-ADMIN-USERS-01: neutralise CSV formula injection. A cell that
 * starts with = + - @ (or a tab/CR that Excel also treats as a formula lead-in)
 * is prefixed with a single quote so a spreadsheet renders it as text, not a
 * live formula (=HYPERLINK(...), =cmd|...). Applied to every cell.
 */
function csvCell(raw: string): string {
  let v = raw;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function buildCsv(users: PlatformUser[]): string {
  const headers = ["Name", "Email", "Roles", "Status", "Department", "MFA", "Last Login"];
  const rows = users.map((u) => [
    u.name ?? "", u.email, u.roles.join(";"), u.status, u.department ?? "",
    u.mfaEnabled ? "Yes" : "No", formatDate(u.lastLoginAt),
  ]);
  return [headers, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\n");
}

function downloadCsv(users: PlatformUser[]) {
  const blob = new Blob([buildCsv(users)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 15;
const SUSPEND_REASON_MIN = 5;

/* ─── Component ─────────────────────────────────────────────────────── */
export function UserManagementPage({
  users: seed,
  source = "api",
  roleOptions,
  currentUserId = null,
  currentUserRoles = [],
}: {
  users: PlatformUser[];
  source?: "api" | "error";
  /** Role keys for the filter — the real catalogue (GAP-...-USERS-05). */
  roleOptions?: string[];
  /** JWT `sub` of the signed-in admin, for the self-suspend guard (USERS-03). */
  currentUserId?: string | null;
  /** The signed-in admin's roles, for PII masking + export gating (USERS-01). */
  currentUserRoles?: string[];
}) {
  const router = useRouter();
  const { data: users, provenance, offline, cachedAt } = useSeededResource<PlatformUser[]>("platformAdmin.users", seed, source, (d) => d.length === 0);

  const canSeePii = currentUserRoles.some((r) => FULL_ACCESS_ROLES.includes(r));

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [suspendTarget, setSuspendTarget] = useState<PlatformUser | null>(null);
  const [resetTarget, setResetTarget] = useState<PlatformUser | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<PlatformUser | null>(null);
  const [busy, setBusy] = useState(false);
  // GAP-PLATFORM-ADMIN-USERS-02: one error string per dialog, so a failed
  // suspend never leaks its message into the reset (or reactivate) dialog.
  const [suspendError, setSuspendError] = useState("");
  const [resetError, setResetError] = useState("");
  const [reactivateError, setReactivateError] = useState("");

  const roleFilterOptions = roleOptions && roleOptions.length > 0
    ? roleOptions
    : Array.from(new Set(users.flatMap((u) => u.roles))).sort();

  // GAP-PLATFORM-ADMIN-USERS-03: count of ACTIVE super_admins, to forbid
  // suspending the last one (an account-lockout guard; the server also enforces).
  const activeSuperAdmins = useMemo(
    () => users.filter((u) => u.status === "active" && u.roles.includes(SUPER_ADMIN_ROLE)).length,
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (q && !u.email.toLowerCase().includes(q) && !(u.name ?? "").toLowerCase().includes(q)) return false;
      if (statusFilter !== "All" && u.status !== statusFilter.toLowerCase()) return false;
      if (roleFilter !== "All" && !u.roles.includes(roleFilter)) return false;
      return true;
    });
  }, [users, search, statusFilter, roleFilter]);

  // GAP-PLATFORM-ADMIN-USERS-06: prune the selection to ids that still exist
  // after a refresh removes rows, so a stale id can never be exported/counted.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(users.map((u) => u.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => { if (live.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [users]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSelect(id: string) {
    setSelected((s) => {
      const c = new Set(s);
      if (c.has(id)) c.delete(id); else c.add(id);
      return c;
    });
  }
  function toggleAll() {
    const pageIds = pageRows.map((u) => u.id);
    const allSelected = pageIds.every((id) => selected.has(id));
    setSelected((s) => { const c = new Set(s); pageIds.forEach((id) => allSelected ? c.delete(id) : c.add(id)); return c; });
  }

  function openSuspend(user: PlatformUser) { setSuspendError(""); setSuspendTarget(user); }
  function openReset(user: PlatformUser) { setResetError(""); setResetTarget(user); }
  function openReactivate(user: PlatformUser) { setReactivateError(""); setReactivateTarget(user); }

  /**
   * GAP-PLATFORM-ADMIN-USERS-01: route the export through a server endpoint
   * that writes an audit event (actor, filter, row count) BEFORE building the
   * CSV in the browser. A failed audit write aborts the download — an
   * unaudited bulk PII egress is exactly what this gap is about.
   */
  async function exportUsers(rows: PlatformUser[], filterLabel: string) {
    if (!canSeePii) return;
    const capped = rows.slice(0, EXPORT_MAX_ROWS);
    try {
      const res = await fetch("/api/proxy/v1/admin/user-exports/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rowCount: capped.length, filter: filterLabel }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      downloadCsv(capped);
    } catch {
      // Surface at the directory level; keep it simple (no inline toast here).
      window.alert("Could not record the export for audit; download cancelled. Please try again.");
    }
  }

  async function confirmSuspend(reason?: string) {
    if (!suspendTarget) return;
    setBusy(true);
    setSuspendError("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/users/${suspendTarget.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended", ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setSuspendTarget(null);
      router.refresh();
    } catch {
      setSuspendError("Could not suspend user.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReactivate() {
    if (!reactivateTarget) return;
    setBusy(true);
    setReactivateError("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/users/${reactivateTarget.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setReactivateTarget(null);
      router.refresh();
    } catch {
      setReactivateError("Could not reactivate user.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset() {
    if (!resetTarget) return;
    setBusy(true);
    setResetError("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setResetTarget(null);
    } catch {
      setResetError("Could not start a password reset for this user.");
    } finally {
      setBusy(false);
    }
  }

  const inpSty: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--bg)" };

  /** Whether Suspend is forbidden for this row (self / last super admin). */
  function suspendBlockedReason(user: PlatformUser): string | null {
    if (currentUserId && user.id === currentUserId) return "You cannot suspend your own account.";
    if (user.roles.includes(SUPER_ADMIN_ROLE) && user.status === "active" && activeSuperAdmins <= 1) {
      return "You cannot suspend the last active super admin.";
    }
    return null;
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="user-mgmt-heading">User directory</h3>
        {canSeePii && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => void exportUsers(users.filter((u) => selected.has(u.id)), "Selected")}>
                Export selected ({selected.size})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void exportUsers(filtered, roleFilter !== "All" || statusFilter !== "All" || search ? "Filtered" : "All")}>
              Export all ({filtered.length})
            </Button>
          </div>
        )}
      </div>

      <div style={{ padding: "8px 16px 0" }}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      </div>

      {/* Filters */}
      <div style={{ padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 10, borderBottom: "1px solid var(--line)" }}>
        <input
          type="search"
          placeholder="Search name or email…"
          style={{ ...inpSty, minWidth: 220 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          aria-label="Search users"
        />
        <select style={inpSty} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} aria-label="Filter by status">
          {["All", "Active", "Suspended", "Pending"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select style={inpSty} value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }} aria-label="Filter by role">
          <option value="All">All roles</option>
          {roleFilterOptions.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }} aria-labelledby="user-mgmt-heading">
          <thead>
            <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "10px 14px", width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={pageRows.length > 0 && pageRows.every((u) => selected.has(u.id))}
                  onChange={toggleAll}
                />
              </th>
              {["User", "Roles", "Department", "Last login", "MFA", "Status", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "start", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink2)", fontSize: 13 }}>
                  No users match the current filters.
                </td>
              </tr>
            ) : pageRows.map((user) => {
              const blocked = suspendBlockedReason(user);
              return (
              <tr key={user.id} style={{ borderBottom: "1px solid var(--line)", background: selected.has(user.id) ? "var(--primary-light, #eff6ff)" : "transparent" }}>
                <td style={{ padding: "10px 14px" }}>
                  <input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleSelect(user.id)} aria-label={`Select ${user.name ?? user.email}`} />
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div className="who">
                    <div className="av" aria-hidden="true" style={{ fontSize: 10, width: 30, height: 30, borderRadius: "50%", background: "var(--primary-light, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary-d)", fontWeight: 700, flexShrink: 0 }}>
                      {(user.name ?? user.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{user.name ?? "—"}</div>
                      <div style={{ fontSize: 12, color: "var(--ink2)", fontFamily: canSeePii ? undefined : "monospace" }}>
                        {canSeePii ? user.email : maskEmail(user.email)}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                    {user.roles.slice(0, 3).map((r) => <RoleBadge key={r} role={r} />)}
                    {user.roles.length > 3 && <span style={{ fontSize: 11, color: "var(--ink2)", alignSelf: "center" }}>+{user.roles.length - 3}</span>}
                    {user.roles.length === 0 && <span style={{ fontSize: 12, color: "var(--ink2)" }}>—</span>}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--ink2)" }}>
                  {user.department ? (canSeePii ? user.department : "••••") : "—"}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink2)", whiteSpace: "nowrap" }}>{formatDate(user.lastLoginAt)}</td>
                <td style={{ padding: "10px 14px" }}>
                  {user.mfaEnabled
                    ? <span className="pill good" style={{ fontSize: 11 }}>MFA on</span>
                    : <span className="pill mut" style={{ fontSize: 11 }}>MFA off</span>}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {/* GAP-PLATFORM-ADMIN-USERS-07: StatusPill humanizes + colours
                      every status (pending/locked/… no longer raw lowercase). */}
                  <StatusPill status={user.status} />
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {/* GAP-PLATFORM-ADMIN-USERS-05: client-side nav, not <a> full reload. */}
                    <Link href={`/tenant-admin/users/${user.id}`} className="btn ghost sm" style={{ fontSize: 11 }}>Edit</Link>
                    {user.status === "suspended" ? (
                      // GAP-PLATFORM-ADMIN-USERS-03: a real Reactivate action.
                      <Button variant="ghost" size="sm" style={{ fontSize: 11 }} onClick={() => openReactivate(user)}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ fontSize: 11, color: "var(--bad, #b42318)" }}
                        disabled={blocked !== null}
                        title={blocked ?? undefined}
                        onClick={() => openSuspend(user)}
                      >
                        Suspend
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" style={{ fontSize: 11 }} onClick={() => openReset(user)}>
                      Reset password
                    </Button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination + selection controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink2)" }}>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>{filtered.length} user{filtered.length === 1 ? "" : "s"}</span>
          {selected.size > 0 && (
            <>
              <span>· {selected.size} selected (across pages)</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </>
          )}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</Button>
          <span style={{ alignSelf: "center" }}>Page {safePage + 1} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next →</Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!suspendTarget}
        title={`Suspend ${suspendTarget?.name ?? suspendTarget?.email ?? "user"}?`}
        description="The user will lose access immediately and their sessions will be invalidated. Reactivate them later from this screen."
        confirmLabel="Suspend user"
        danger
        requireReason
        reasonLabel="Reason for suspension"
        minReasonLength={SUSPEND_REASON_MIN}
        busy={busy}
        errorMessage={suspendError || undefined}
        onConfirm={(reason) => void confirmSuspend(reason)}
        onCancel={() => { if (!busy) { setSuspendError(""); setSuspendTarget(null); } }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        title={`Reactivate ${reactivateTarget?.name ?? reactivateTarget?.email ?? "user"}?`}
        description="The user will be able to sign in again."
        confirmLabel="Reactivate user"
        busy={busy}
        errorMessage={reactivateError || undefined}
        onConfirm={() => void confirmReactivate()}
        onCancel={() => { if (!busy) { setReactivateError(""); setReactivateTarget(null); } }}
      />

      <ConfirmDialog
        open={!!resetTarget}
        title={`Reset password for ${resetTarget?.name ?? resetTarget?.email ?? "user"}?`}
        description="A password-reset request will be recorded and sent to Keycloak. The user will need to set a new password on next sign-in."
        confirmLabel="Reset password"
        busy={busy}
        errorMessage={resetError || undefined}
        onConfirm={() => void confirmReset()}
        onCancel={() => { if (!busy) { setResetError(""); setResetTarget(null); } }}
      />
    </div>
  );
}

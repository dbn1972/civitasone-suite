"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

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

const ALL_ROLES = [
  "super_admin", "platform_admin", "tenant_admin",
  "hr_admin", "payroll_admin", "finance_admin",
  "audit_admin", "dept_head", "hr_staff",
];

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
    <span style={{ ...colors, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, marginRight: 4, display: "inline-block" }}>
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

function exportCsv(users: PlatformUser[]) {
  const headers = ["Name", "Email", "Roles", "Status", "Department", "MFA", "Last Login"];
  const rows = users.map((u) => [
    u.name ?? "", u.email, u.roles.join(";"), u.status, u.department ?? "",
    u.mfaEnabled ? "Yes" : "No", formatDate(u.lastLoginAt),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 15;

/* ─── Component ─────────────────────────────────────────────────────── */
export function UserManagementPage({ users: seed, source = "api" }: { users: PlatformUser[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: users } = useSeededResource<PlatformUser[]>("platformAdmin.users", seed, source, (d) => d.length === 0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [suspendTarget, setSuspendTarget] = useState<PlatformUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (q && !u.email.toLowerCase().includes(q) && !(u.name ?? "").toLowerCase().includes(q)) return false;
      if (statusFilter !== "All" && u.status !== statusFilter.toLowerCase()) return false;
      if (roleFilter !== "All" && !u.roles.includes(roleFilter)) return false;
      return true;
    });
  }, [users, search, statusFilter, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSelect(id: string) {
    setSelected((s) => { const c = new Set(s); c.has(id) ? c.delete(id) : c.add(id); return c; });
  }
  function toggleAll() {
    const pageIds = pageRows.map((u) => u.id);
    const allSelected = pageIds.every((id) => selected.has(id));
    setSelected((s) => { const c = new Set(s); pageIds.forEach((id) => allSelected ? c.delete(id) : c.add(id)); return c; });
  }

  async function confirmSuspend() {
    if (!suspendTarget) return;
    setBusy(true);
    setError("");
    try {
      await fetch(`/api/proxy/v1/admin/users/${suspendTarget.id}/suspend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }).catch(() => null);
      setSuspendTarget(null);
      router.refresh();
    } catch {
      setError("Could not suspend user.");
    } finally {
      setBusy(false);
    }
  }

  const inpSty: React.CSSProperties = { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12.5, fontFamily: "inherit", color: "var(--ink)", background: "var(--bg)" };

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="user-mgmt-heading">User directory</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <button type="button" className="btn ghost sm" onClick={() => exportCsv(users.filter((u) => selected.has(u.id)))}>
              Export selected ({selected.size})
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={() => exportCsv(filtered)}>
            Export all ({filtered.length})
          </button>
        </div>
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
          {ALL_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
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
              {["User", "Roles", "Dept", "Last login", "MFA", "Status", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
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
            ) : pageRows.map((user) => (
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
                      <div style={{ fontSize: 12, color: "var(--ink2)" }}>{user.email}</div>
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
                <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--ink2)" }}>{user.department ?? "—"}</td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink2)", whiteSpace: "nowrap" }}>{formatDate(user.lastLoginAt)}</td>
                <td style={{ padding: "10px 14px" }}>
                  {user.mfaEnabled
                    ? <span className="pill good" style={{ fontSize: 11 }}>MFA on</span>
                    : <span className="pill mut" style={{ fontSize: 11 }}>MFA off</span>}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {user.status === "active"
                    ? <span className="pill good" style={{ fontSize: 11 }}>Active</span>
                    : user.status === "suspended"
                    ? <span className="pill bad" style={{ fontSize: 11 }}>Suspended</span>
                    : <span className="pill warn" style={{ fontSize: 11 }}>{user.status}</span>}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <a href={`/tenant-admin/users/${user.id}`} className="btn ghost sm" style={{ fontSize: 11 }}>Edit</a>
                    {user.status !== "suspended" && (
                      <button type="button" className="btn ghost sm" style={{ fontSize: 11, color: "var(--bad, #b42318)" }} onClick={() => setSuspendTarget(user)}>
                        Suspend
                      </button>
                    )}
                    <a href={`/tenant-admin/users/${user.id}/password-reset`} className="btn ghost sm" style={{ fontSize: 11 }}>Reset pwd</a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink2)" }}>
        <span>{filtered.length} user{filtered.length === 1 ? "" : "s"}{selected.size > 0 ? ` · ${selected.size} selected` : ""}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn ghost sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</button>
          <span style={{ alignSelf: "center" }}>Page {safePage + 1} / {totalPages}</span>
          <button type="button" className="btn ghost sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next →</button>
        </div>
      </div>

      <ConfirmDialog
        open={!!suspendTarget}
        title={`Suspend ${suspendTarget?.name ?? suspendTarget?.email ?? "user"}?`}
        description="The user will lose access immediately. Their sessions will be invalidated. You can reactivate from Keycloak."
        confirmLabel="Suspend user"
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={() => void confirmSuspend()}
        onCancel={() => { if (!busy) setSuspendTarget(null); }}
      />
    </div>
  );
}

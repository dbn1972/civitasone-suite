"use client";
import { useState, useMemo, useId } from "react";
import { PageHeader, StatCard, DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

// ── UX decisions ──────────────────────────────────────────────────────────────
// 1. Avatar initials + email + name tripled: name primary, email secondary (scannability)
// 2. Role badges inline — colour-coded per role family for quick recognition
// 3. Last-login in Indian date format (GFR 2017); missing = "Never" not empty cell
// 4. Status chip: Active=green, Suspended=red, Pending=amber — no ambiguity
// 5. Edit Roles opens a slide-over Sheet — preserves context vs full page nav
// 6. Reset Password disabled + title tooltip: prevents Keycloak bypass
// 7. Suspend/Activate is a single toggle button that changes label by state
// 8. Bulk export at top-right — reachable without scrolling table
// 9. Filter tabs (All/Active/Suspended/Pending) keep filter state visible
// 10. Search box covers name+email — most common admin lookup pattern
// ─────────────────────────────────────────────────────────────────────────────

type UserStatus = "active" | "suspended" | "pending";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  lastLogin: string | null;
  status: UserStatus;
  department: string;
}

type AdminUserRow = AdminUser & Record<string, unknown>;

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  super_admin: { bg: "#fef2f2", color: "#991b1b" },
  platform_admin: { bg: "#f5f3ff", color: "#6d28d9" },
  tenant_admin: { bg: "#eff6ff", color: "#1d4ed8" },
  hr_admin: { bg: "#f0fdf4", color: "#15803d" },
  hr_staff: { bg: "#ecfdf5", color: "#065f46" },
  payroll_admin: { bg: "#fff7ed", color: "#c2410c" },
  finance_admin: { bg: "#fefce8", color: "#854d0e" },
  dept_head: { bg: "#f0f9ff", color: "#0369a1" },
  audit_admin: { bg: "#fdf4ff", color: "#7e22ce" },
};

const MOCK_USERS: AdminUser[] = [
  { id: "u1", name: "Rajesh Kumar", email: "rajesh.kumar@finmin.nic.in", roles: ["hr_admin", "audit_admin"], lastLogin: "2025-08-14T09:30:00Z", status: "active", department: "Human Resources" },
  { id: "u2", name: "Priya Sharma", email: "priya.sharma@finmin.nic.in", roles: ["payroll_admin"], lastLogin: "2025-08-13T14:20:00Z", status: "active", department: "Payroll & Accounts" },
  { id: "u3", name: "Anand Verma", email: "anand.verma@finmin.nic.in", roles: ["dept_head", "hr_staff"], lastLogin: "2025-08-12T11:05:00Z", status: "active", department: "Budget Division" },
  { id: "u4", name: "Sunita Patel", email: "sunita.patel@finmin.nic.in", roles: ["finance_admin"], lastLogin: "2025-08-10T16:45:00Z", status: "active", department: "Finance" },
  { id: "u5", name: "Mohan Das", email: "mohan.das@finmin.nic.in", roles: ["audit_admin"], lastLogin: "2025-08-09T08:15:00Z", status: "active", department: "Internal Audit" },
  { id: "u6", name: "Kavita Singh", email: "kavita.singh@finmin.nic.in", roles: ["platform_admin"], lastLogin: "2025-08-14T07:00:00Z", status: "active", department: "IT Infrastructure" },
  { id: "u7", name: "Deepak Joshi", email: "deepak.joshi@finmin.nic.in", roles: ["hr_staff"], lastLogin: "2025-08-08T13:30:00Z", status: "active", department: "Human Resources" },
  { id: "u8", name: "Meena Rao", email: "meena.rao@finmin.nic.in", roles: ["super_admin"], lastLogin: "2025-08-14T10:00:00Z", status: "active", department: "Administration" },
  { id: "u9", name: "Arun Mehta", email: "arun.mehta@finmin.nic.in", roles: ["hr_staff"], lastLogin: "2025-07-20T09:00:00Z", status: "suspended", department: "Human Resources" },
  { id: "u10", name: "Ritu Gupta", email: "ritu.gupta@finmin.nic.in", roles: ["finance_admin"], lastLogin: null, status: "pending", department: "Finance" },
  { id: "u11", name: "Vikram Nair", email: "vikram.nair@finmin.nic.in", roles: ["hr_admin"], lastLogin: "2025-08-01T11:00:00Z", status: "active", department: "Personnel" },
  { id: "u12", name: "Nisha Trivedi", email: "nisha.trivedi@finmin.nic.in", roles: ["hr_staff"], lastLogin: null, status: "pending", department: "Human Resources" },
];

const STATUS_FILTERS = ["All", "Active", "Suspended", "Pending"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const ALL_ROLES = Object.keys(ROLE_COLORS) as Array<keyof typeof ROLE_COLORS>;

function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 8, fontSize: 10.5, fontWeight: 650, background: colors.bg, color: colors.color, marginRight: 4, marginBottom: 2, whiteSpace: "nowrap" }}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function StatusChip({ status }: { status: UserStatus }) {
  if (status === "active") return <span className="pill good">Active</span>;
  if (status === "suspended") return <span className="pill bad">Suspended</span>;
  return <span className="pill" style={{ background: "#fffbeb", color: "#b45309" }}>Pending</span>;
}

function EditRolesSheet({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSave: (userId: string, roles: string[]) => void;
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(user?.roles ?? []);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const safeUser = user;

  function toggleRole(r: string) {
    setSelectedRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/proxy/v1/admin/users/${safeUser.id}/roles`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles: selectedRoles }),
      });
      onSave(safeUser.id, selectedRoles);
      onClose();
    } catch {
      // keep open
    } finally {
      setBusy(false);
    }
  }

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
        <div style={{ display: "grid", gap: 10 }}>
          {ALL_ROLES.map((r) => {
            const active = selectedRoles.includes(r);
            return (
              <label key={r} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${active ? "#4f46e5" : "var(--line)"}`, background: active ? "#eef2ff" : "transparent", transition: "all 0.12s" }}>
                <input type="checkbox" checked={active} onChange={() => toggleRole(r)} style={{ width: 15, height: 15, cursor: "pointer" }} />
                <div>
                  <RoleBadge role={r} />
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()} aria-busy={busy}>
            {busy ? "Saving…" : "Save roles"}
          </button>
          <button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>(MOCK_USERS);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [editUser, setEditUser] = useState<AdminUser | null>(null);

  const filtered = useMemo<AdminUserRow[]>(() => {
    const base = filter === "All" ? users : users.filter((u) => u.status === filter.toLowerCase());
    return base as AdminUserRow[];
  }, [users, filter]);

  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const pending = users.filter((u) => u.status === "pending").length;

  function toggleStatus(userId: string, currentStatus: UserStatus) {
    const newStatus: UserStatus = currentStatus === "active" ? "suspended" : "active";
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status: newStatus } : u));
    void fetch(`/api/proxy/v1/admin/users/${userId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  }

  function handleRolesSaved(userId: string, roles: string[]) {
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, roles } : u));
  }

  function downloadCsv() {
    const header = "Name,Email,Roles,Last Login,Status,Department";
    const rows = filtered.map((u) =>
      [u.name, u.email, u.roles.join("|"), u.lastLogin ? formatIndianDate(u.lastLogin) : "Never", u.status, u.department].join(",")
    );
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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="User Management"
        subtitle="All platform users — roles, status, last login, and access controls."
        back="/admin"
        actions={
          <button type="button" className="btn ghost sm" onClick={downloadCsv}>Export CSV</button>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total users" value={users.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🕐" iconBg="#fffbeb" label="Pending setup" value={pending} />
      </div>
      <div className="card">
        <div className="card-h">
          <h3>User directory</h3>
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
        </div>
        <DataTable<AdminUserRow>
          columns={[
            {
              key: "name",
              label: "User",
              render: (u) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e0e7ff", color: "#4f46e5", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-hidden="true">
                    {String(u.name).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 550 }}>{String(u.name)}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)" }}>{String(u.email)}</div>
                  </div>
                </div>
              ),
            },
            {
              key: "department",
              label: "Department",
              render: (u) => <span style={{ fontSize: 13, color: "var(--ink2)" }}>{String(u.department)}</span>,
            },
            {
              key: "roles",
              label: "Roles",
              sortable: false,
              render: (u) => (
                <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 220 }}>
                  {(u.roles as string[]).map((r) => <RoleBadge key={r} role={r} />)}
                </div>
              ),
            },
            {
              key: "lastLogin",
              label: "Last login",
              render: (u) => (
                <span style={{ fontSize: 12.5, whiteSpace: "nowrap", color: u.lastLogin ? "var(--ink2)" : "var(--ink3)" }}>
                  {u.lastLogin ? formatIndianDate(String(u.lastLogin)) : "Never"}
                </span>
              ),
            },
            {
              key: "status",
              label: "Status",
              render: (u) => <StatusChip status={u.status as UserStatus} />,
            },
            {
              key: "id",
              label: "Actions",
              sortable: false,
              render: (u) => (
                <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setEditUser(u as AdminUser)}
                    style={{ fontSize: 11.5 }}
                  >
                    Edit Roles
                  </button>
                  <button
                    type="button"
                    className={`btn ghost sm`}
                    onClick={() => toggleStatus(String(u.id), u.status as UserStatus)}
                    style={{ fontSize: 11.5, color: u.status === "active" ? "#b42318" : "#027a48" }}
                  >
                    {u.status === "active" ? "Suspend" : "Activate"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled
                    title="Password reset is managed via Keycloak — click the Keycloak Admin link to proceed"
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
          emptyTitle="No users match"
          emptyMessage="Try a different filter or clear the search."
        />
      </div>
      <EditRolesSheet
        user={editUser}
        onClose={() => setEditUser(null)}
        onSave={handleRolesSaved}
      />
    </main>
  );
}

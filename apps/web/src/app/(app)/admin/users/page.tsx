import { PageHeader, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getAdminUsersList, getAdminRolesList } from "@/app/_data/loaders";
import { AdminUsersManager } from "./AdminUsersManager";

// COMP-004: this page used to render 12 hardcoded MOCK_USERS with a role
// taxonomy and department/last-login fields that don't exist anywhere in
// identity-service's real user row. Status/roles actions already fired real
// requests (COMP-004's admin-service commit added the status/roles proxy
// routes), but the underlying list itself, and the "did it actually work"
// feedback, were both fake — a suspend click flipped local state regardless
// of what the server returned. Now: the directory is GET /v1/admin/users
// (identity-service's real user rows) via a server loader; every mutation
// (status toggle, role edit) is a real PATCH, confirmed before the row
// updates, with a visible error banner on failure instead of a silent local
// flip. Department and last-login columns are dropped rather than shown as
// invented values — identity-service doesn't track either at this layer
// (same honest-omission call already made for GET /v1/admin/mfa/users, see
// gap/routes.ts).
export default async function AdminUsersPage() {
  const [{ data: users, source }, { data: roles }] = await Promise.all([getAdminUsersList(), getAdminRolesList()]);

  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const other = users.length - active - suspended;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="User Management"
        subtitle="All platform users — roles, status, and access controls."
        back="/admin"
      />
      <DataSourceBadge source={source} message="Couldn't load the user directory — showing nothing" />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total users" value={users.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔒" iconBg="#fffbeb" label="Locked / deactivated" value={other} />
      </div>
      <AdminUsersManager initialUsers={users} roles={roles} source={source} />
    </main>
  );
}

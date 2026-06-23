import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAdminUsers } from "../../../_data/loaders";
import { UsersTable } from "./UsersTable";

export default async function AdminUsersPage() {
  const { data: users, source } = await getAdminUsers();

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaEnabled = users.filter((u) => u.mfaEnabled).length;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Manage Users"
        subtitle="Tenant user directory with role assignment and MFA status."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ Invite User</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA Enabled" value={mfaEnabled} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <UsersTable users={users} source={source} />
    </div>
  );
}

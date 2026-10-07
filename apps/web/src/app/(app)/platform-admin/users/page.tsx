import { PageHeader, StatCard } from "@/app/_components/ds";
import { getAdminUsers, getAdminRolesList } from "@/app/_data/loaders";
import { getSessionRoles, getSessionUserId, requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { Breadcrumb } from "../Breadcrumb";
import { UserManagementPage } from "./UserManagementPage";
import { mapAdminUsers } from "./mapAdminUsers";

export default async function PlatformUsersPage() {
  requireAnyRole(PLATFORM_ADMIN_ROLES, "/dashboard");
  const [{ data: raw, source }, { data: rolesCatalogue }] = await Promise.all([
    getAdminUsers(),
    getAdminRolesList(),
  ]);

  // GAP-PLATFORM-ADMIN-USERS-04: a row without a real string id used to be
  // given `String(Math.random())`, which changed on every render (breaking
  // React keys + checkbox selection) and would target a FAKE id if an admin
  // clicked Suspend/Reset. mapAdminUsers drops such rows instead of inventing
  // an id; the actions below only ever operate on a real identity-service id.
  const users = mapAdminUsers(raw);

  const sessionRoles = getSessionRoles();
  const currentUserId = getSessionUserId();

  // GAP-PLATFORM-ADMIN-USERS-05: the role filter is driven by the real role
  // catalogue (same source as /platform-admin/roles), not a hard-coded list of
  // 9 roles. Fall back to the role keys actually present on the loaded users
  // when the catalogue is empty/unreachable, so the filter is never blank.
  const catalogueRoleKeys = rolesCatalogue.map((r) => r.key).filter((k) => k.length > 0);
  const roleOptions = catalogueRoleKeys.length > 0
    ? catalogueRoleKeys
    : Array.from(new Set(users.flatMap((u) => u.roles))).sort();

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaOn = users.filter((u) => u.mfaEnabled).length;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "User Management" }]} />
      <PageHeader
        back="/platform-admin"
        title="User Management"
        subtitle="All platform users with role badges, last-login, status. Bulk select, export, suspend, and reset password."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total users" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA enabled" value={mfaOn} />
      </div>
      <UserManagementPage
        users={users}
        source={source}
        roleOptions={roleOptions}
        currentUserId={currentUserId}
        currentUserRoles={sessionRoles}
      />
    </div>
  );
}

import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { getAdminRoles } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { Breadcrumb } from "../Breadcrumb";
import { RolesTable } from "./RolesTable";
import { LABELS } from "@/lib/labels";

// GAP-TENANT-ADMIN-ROLES-04: who may create a role. The route layout already
// admits only tenant_admin/platform_admin/super_admin; role creation is further
// an admin-level action, so a view-only admin outside this set gets no button
// (the policy service remains the authority and 403s regardless).
const ROLE_CREATE_ROLES = ["tenant_admin", "platform_admin", "super_admin"];

export default async function AdminRolesPage() {
  const result = await getAdminRoles();
  const { data: roles } = result;
  // GAP-TENANT-ADMIN-ROLES-01: distinguish a real outage from a genuinely empty
  // list. On error, show "—" tiles and a retry card, never 0 + an empty table.
  const errored = toResourceState(result).status === "error";
  const canCreate = hasAnyRole(getSessionRoles(), ROLE_CREATE_ROLES);

  const total = roles.length;
  const systemRoles = roles.filter((r) => r.isSystemRole).length;
  const customRoles = roles.filter((r) => !r.isSystemRole).length;
  const totalAssigned = roles.reduce((sum, r) => sum + r.userCount, 0);

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Roles" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Manage Roles"
        subtitle={`Role definitions and permission assignment for your ${LABELS.tenant}.`}
        help="tenant-admin"
        actions={<PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Roles" />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Roles" value={errored ? "—" : total} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="System Roles" value={errored ? "—" : systemRoles} />
        <StatCard icon="✏️" iconBg="#ecfdf3" label="Custom Roles" value={errored ? "—" : customRoles} />
        {/* GAP-TENANT-ADMIN-ROLES-03: this is a count of role assignments, not of
            distinct users — a user with 2 roles counts twice. Label + hint make
            that explicit so it is not mistaken for a user headcount. */}
        <StatCard icon="👥" iconBg="#fffaeb" label="Role assignments" value={errored ? "—" : totalAssigned} hint="Total role assignments. A user holding two roles counts twice — this is not a distinct-user count." />
      </div>
      {errored ? (
        <Card title="Role definitions" padding>
          <RefreshErrorState error={toHumanError("load", { area: "roles" })} backHref="/tenant-admin" />
        </Card>
      ) : (
        <RolesTable
          canCreate={canCreate}
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            isSystemRole: r.isSystemRole,
            userCount: r.userCount,
          }))}
        />
      )}
    </div>
  );
}

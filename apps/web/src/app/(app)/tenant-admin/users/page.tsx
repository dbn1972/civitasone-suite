import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, Term } from "../../../_components/ds";
import { getAdminUsers } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { UsersTable } from "./UsersTable";
import { LABELS } from "@/lib/labels";

export default async function AdminUsersPage() {
  const { data: users, source } = await getAdminUsers();

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaEnabled = users.filter((u) => u.mfaEnabled).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Manage Users" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Manage Users"
        subtitle={<>Your {LABELS.tenant}&apos;s user directory with role assignment and <Term name="MFA" /> status.</>}
        help="tenant-admin"
        actions={<PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Users" />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA Enabled" value={mfaEnabled} />
      </div>
      {/* UX-012: the data-source badge now lives inside UsersTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <UsersTable users={users} source={source} />
    </main>
  );
}
